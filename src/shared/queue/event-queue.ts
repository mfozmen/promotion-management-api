import { Queue, type Job, type JobsOptions } from 'bullmq';
import type { z, ZodType } from 'zod';
import type { PromotionBoundary } from '../../modules/promotion/domain/dto/promotion-boundary.js';
import type { QueueName } from './queue-name.js';

/** A catalogue of event names to the schema each payload is parsed against. */
type Registry = Record<string, ZodType>;

/**
 * The boundary methods name one event, so a catalogue without it is a compile error.
 * A name is not an import: `shared/` still depends on no module.
 */
type PromotionRegistry = { 'promotion.changed': ZodType<{ promotionId: number }> };

/**
 * The producer side of the queues: policy, routing and the boundary job ids. ADR-0003.
 *
 * Generic over the catalogue, which is passed in rather than imported, because
 * `shared/` imports no module; the concrete one lives in `src/events/`.
 */
export class EventQueue<R extends Registry & PromotionRegistry> {
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

  /**
   * `db` is passed, not fixed, so `config.ts`'s refusal to share a database with the
   * read model is reachable. `prefix` scopes every key, so a test's counts are its own.
   */
  static connect<R extends Registry & PromotionRegistry>(
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

  async publish<N extends keyof R & string>(
    name: N,
    payload: z.infer<R[N]>,
    options?: JobsOptions,
  ): Promise<Job> {
    return this.add(name, payload, options);
  }

  /**
   * `now` is a parameter so one clock decides: PostgreSQL's, never the process's. Write-once
   * per id: BullMQ ignores an `add` for an id it still holds, and the returned `Job` then
   * describes the request rather than what is stored. ADR-0007.
   */
  async schedulePromotionBoundary(
    promotionId: number,
    boundary: PromotionBoundary,
    at: Date,
    now: Date,
  ): Promise<Job> {
    return this.add(
      'promotion.changed',
      { promotionId },
      {
        jobId: EventQueue.boundaryJobId(promotionId, boundary),
        delay: Math.max(0, at.getTime() - now.getTime()),
      },
    );
  }

  /**
   * BullMQ's codes: `1` when nothing blocked it, including when there was no such
   * job, `0` when a worker already holds it. A cancel racing a running activate
   * gets `0` but still ends correct: cancel publishes `promotion.changed` anyway.
   */
  async removePromotionBoundaries(promotionId: number): Promise<Record<PromotionBoundary, number>> {
    const [activate, expire] = await this.bounded(
      `removePromotionBoundaries(${promotionId})`,
      Promise.all([
        this.queues.promotions.remove(EventQueue.boundaryJobId(promotionId, 'activate')),
        this.queues.promotions.remove(EventQueue.boundaryJobId(promotionId, 'expire')),
      ]),
    );
    return { activate, expire };
  }

  /** Reads only: `add` here would skip the parse and the timeout `publish` exists to give. */
  inspect(name: QueueName): Pick<Queue, 'getJob' | 'getWaitingCount' | 'getDelayedCount'> {
    return this.queues[name];
  }

  /** Closing does not drain, so `SIGTERM` stops the producers first; it frees the socket. */
  async close(): Promise<void> {
    await Promise.all(Object.values(this.queues).map((queue) => queue.close()));
  }

  private static boundaryJobId(promotionId: number, boundary: PromotionBoundary): string {
    return `promo:${promotionId}:${boundary}`;
  }

  /**
   * The parse is at the producer, so a malformed payload fails in the request that made
   * it. `publish` and the boundary methods share this rather than each other, because a
   * boundary names one event and the generic signature cannot narrow to it.
   */
  private async add(name: string, payload: unknown, options?: JobsOptions): Promise<Job> {
    const schema = this.registry[name] as ZodType;
    const queue = this.queues[this.routing[name as keyof R]];
    return this.bounded(`publish("${name}")`, queue.add(name, schema.parse(payload), options));
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
