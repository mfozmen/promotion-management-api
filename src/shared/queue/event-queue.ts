import { Queue, type Job, type JobsOptions } from 'bullmq';
import type { z, ZodType } from 'zod';
import type { QueueName } from './queue-name.js';

/** A catalogue of event names to the schema each payload is parsed against. */
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

  /** Connecting pays DNS and a TLS handshake that operating on an open socket does not. */
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
      catalog: new Queue('catalog', options),
      ingestion: new Queue('ingestion', options),
      maintenance: new Queue('maintenance', options),
    };
    for (const queue of Object.values(queues)) {
      // An `error` event with no listener is an uncaught exception.
      queue.on('error', (error: Error) => console.error(`queue ${queue.name}:`, error.message));
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

  /** BullMQ's codes: `1` when nothing blocked it, `0` when a worker already holds it. */
  async remove(name: QueueName, jobId: string): Promise<number> {
    return this.bounded(`remove("${jobId}")`, this.queues[name].remove(jobId));
  }

  /** Reads only: `add` here would skip the parse and the timeout `publish` exists to give. */
  inspect(name: QueueName): Pick<Queue, 'getJob' | 'getWaitingCount' | 'getDelayedCount'> {
    return this.queues[name];
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
      // The loser still settles, and an unhandled rejection would take the process down.
      work.catch(() => undefined);
    }
  }
}
