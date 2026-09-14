import { Queue, type Job, type JobsOptions } from 'bullmq';
import type { z, ZodType } from 'zod';
import type { QueueName } from './queue-name.js';
import { logger } from '../logger.js';

type Registry = Record<string, ZodType>;

/** The producer side of the queues: policy and routing, generic over its catalogue. ADR-0003. */
export class EventQueue<R extends Registry> {
  /** `removeOnFail: false` is what makes the failed set the dead-letter queue. */
  static readonly defaultJobOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: false,
  } as const satisfies JobsOptions;

  /** A timed-out operation may still land: a fast failure, not a known outcome. */
  static readonly OPERATION_TIMEOUT_MS = 2_000;

  static readonly CONNECT_TIMEOUT_MS = 10_000;

  private constructor(
    private readonly queues: Record<QueueName, Queue>,
    private readonly registry: R,
    private readonly routing: Record<keyof R, QueueName>,
  ) {}

  /** `prefix` scopes every key, so a test's counts are its own. */
  static connect<R extends Registry>(
    redisUrl: string,
    db: number,
    registry: R,
    routing: Record<keyof R, QueueName>,
    prefix = 'bull',
  ): EventQueue<R> {
    const options = {
      connection: { url: redisUrl, db, connectTimeout: EventQueue.CONNECT_TIMEOUT_MS },
      defaultJobOptions: EventQueue.defaultJobOptions,
      prefix,
    };
    const queues = {
      promotions: new Queue('promotions', options),
      products: new Queue('products', options),
      ingestion: new Queue('ingestion', options),
      maintenance: new Queue('maintenance', options),
    };
    for (const queue of Object.values(queues)) {
      // An `error` event with no listener is an uncaught exception.
      queue.on('error', (error: Error) => {
        logger.error({ queue: queue.name, err: error }, 'queue error');
      });
    }
    return new EventQueue(queues, registry, routing);
  }

  /** The payload is parsed here, so a malformed one fails in the request that made it. */
  async publish<N extends keyof R & string>(
    name: N,
    payload: z.infer<R[N]>,
    options?: JobsOptions,
  ): Promise<Job> {
    const schema = this.registry[name] as ZodType;
    return this.bounded(
      `publish("${name}")`,
      this.queues[this.routing[name]].add(name, schema.parse(payload), options),
    );
  }

  /**
   * A repeatable job, keyed by the event name alone: one schedule per event, so a restart
   * re-asserts it instead of adding a second. The id is built here and nowhere else, and the
   * name is what BullMQ parses — no colons, the character it refuses
   * in a custom id unless they split it in exactly three.
   */
  async schedule<N extends keyof R & string>(
    name: N,
    everyMs: number,
    payload: z.infer<R[N]>,
  ): Promise<void> {
    const schema = this.registry[name] as ZodType;
    await this.bounded(
      `schedule("${name}")`,
      this.queues[this.routing[name]].upsertJobScheduler(
        name,
        { every: everyMs },
        { name, data: schema.parse(payload) },
      ),
    );
  }

  /** `1` also means there was no such job, so a code is not proof of a removal. */
  async remove<N extends keyof R & string>(name: N, jobId: string): Promise<number> {
    return this.bounded(`remove("${jobId}")`, this.queues[this.routing[name]].remove(jobId));
  }

  /**
   * Read methods. `getFailedCount` is here because `removeOnFail: false` makes the failed
   * set the dead-letter queue, and a dead-letter queue nothing can count is not one. Not a
   * read-only seam: `getJob` hands back a live `Job` carrying `remove`, `retry` and
   * `promote`, so a caller narrows to the fields it needs rather than passing a handle on.
   */
  inspect(
    name: QueueName,
  ): Pick<Queue, 'getJob' | 'getWaitingCount' | 'getDelayedCount' | 'getFailedCount'> {
    return this.queues[name];
  }

  /**
   * Every job in one queue's failed set, back to waiting, in pages. Bull Board
   * retries one job at a time, which is an operator story for one poisoned job
   * and not for the hundred a bad deploy leaves behind.
   *
   * Paged rather than read whole: a failed set is unbounded by design, since
   * nothing trims it.
   *
   * Each job is retried at most once per run, and that is the whole of the
   * termination argument. A retried job that fails again re-enters the set while
   * this is still walking it, so a loop that stopped only when the set emptied
   * would never stop against a consumer that rejects everything — measured at
   * 157 retries of three jobs before the count was bounded this way.
   */
  async retryFailed(name: QueueName, pageSize = 100): Promise<number> {
    const queue = this.queues[name];
    const seen = new Set<string>();

    for (;;) {
      const failed = await this.bounded(`getFailed("${name}")`, queue.getFailed(0, pageSize - 1));
      const fresh = failed.filter((job) => job.id !== undefined && !seen.has(job.id));
      if (fresh.length === 0) return seen.size;

      for (const job of fresh) {
        seen.add(job.id as string);
        await job.retry();
      }
    }
  }

  /** The queues this bus holds, so a reader iterates what exists rather than a second list. */
  all(): Queue[] {
    return Object.values(this.queues);
  }

  /** Closing does not drain, so `SIGTERM` stops the producers first; it frees the socket. */
  async close(): Promise<void> {
    await Promise.all(Object.values(this.queues).map((queue) => queue.close()));
  }

  private async bounded<T>(operation: string, work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `${operation} did not confirm within ${EventQueue.OPERATION_TIMEOUT_MS} ms; it may still land`,
                ),
              ),
            EventQueue.OPERATION_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      // `Promise.race` has already handled the loser, so this is not a crash guard: it is
      // the only place a failure arriving after the bound is recorded.
      work.catch((error: unknown) => {
        logger.error({ operation, err: error }, 'queue operation failed');
      });
    }
  }
}
