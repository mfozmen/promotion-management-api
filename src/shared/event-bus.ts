import { Queue, type Job, type JobsOptions } from 'bullmq';
import type { PromotionBoundary } from '../modules/promotion/domain/dto/promotion-boundary.js';
import type { EventName } from './event-name.js';
import type { EventPayload } from './event-payload.js';
import { eventSchemas } from './event-schemas.js';
import type { QueueName } from './queue-name.js';
import { queueOfEvent } from './queue-of-event.js';

/** The producer side of the queues: policy, routing and the boundary job ids. ADR-0003. */
export class EventBus {
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

  private constructor(private readonly queues: Record<QueueName, Queue>) {}

  /**
   * `db` is passed, not fixed, so `config.ts`'s refusal to share a database with the
   * read model is reachable. `prefix` scopes every key, so a test's counts are its own.
   */
  static connect(redisUrl: string, db: number, prefix = 'bull'): EventBus {
    const options = {
      connection: { url: redisUrl, db, connectTimeout: EventBus.CONNECT_TIMEOUT_MS },
      defaultJobOptions: EventBus.defaultJobOptions,
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
    return new EventBus(queues);
  }

  async publish<N extends EventName>(
    name: N,
    payload: EventPayload<N>,
    options?: JobsOptions,
  ): Promise<Job> {
    return this.bounded(
      `publish("${name}")`,
      this.queues[queueOfEvent[name]].add(name, EventBus.parse(name, payload), options),
    );
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
    return this.publish(
      'promotion.changed',
      { promotionId },
      {
        jobId: EventBus.boundaryJobId(promotionId, boundary),
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
        this.queues.promotions.remove(EventBus.boundaryJobId(promotionId, 'activate')),
        this.queues.promotions.remove(EventBus.boundaryJobId(promotionId, 'expire')),
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

  /** At the producer, so a malformed payload fails in the request that made it. */
  private static parse<N extends EventName>(name: N, payload: EventPayload<N>): EventPayload<N> {
    return eventSchemas[name].parse(payload) as EventPayload<N>;
  }

  private static boundaryJobId(promotionId: number, boundary: PromotionBoundary): string {
    return `promo:${promotionId}:${boundary}`;
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
                  `${operation} did not confirm within ${EventBus.OPERATION_TIMEOUT_MS} ms; it may still land`,
                ),
              ),
            EventBus.OPERATION_TIMEOUT_MS,
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
