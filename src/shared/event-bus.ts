import { Queue, type Job, type JobsOptions } from 'bullmq';
import type { PromotionBoundary } from '../modules/promotion/domain/dto/promotion-boundary.js';
import { parseEvent, queueOfEvent, type EventName, type EventPayload, type QueueName } from './events.js';

/**
 * The event bus: BullMQ queues on their own Redis logical database, with the
 * retry, backoff and dead-letter policy every job inherits.
 *
 * Holds the queues, so it is a class rather than a set of functions passing them
 * back and forth. `connect` is the only way to build one, because a queue with no
 * `error` listener turns a Redis blip into an uncaught exception.
 */
export class EventBus {
  /** Database 0 holds the read model; keeping the queue on its own logical database means neither can destroy the other. */
  static readonly QUEUE_DB = 1;

  /** `removeOnFail: false` is what makes the failed set the dead-letter queue. */
  static readonly defaultJobOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: false,
  } as const satisfies JobsOptions;

  /**
   * ioredis reconnects for ever and BullMQ's `add` waits for it, so an unreachable
   * Redis hangs the request that already committed. The race cancels nothing, so a
   * timed-out operation may still land: a fast failure, not a known outcome.
   */
  static readonly OPERATION_TIMEOUT_MS = 2_000;

  /** A different budget from operating on an open connection: a managed
   *  `rediss://` instance pays DNS and a TLS handshake once. */
  static readonly CONNECT_TIMEOUT_MS = 10_000;

  private constructor(private readonly queues: Record<QueueName, Queue>) {}

  static connect(redisUrl: string): EventBus {
    const options = {
      connection: {
        url: redisUrl,
        db: EventBus.QUEUE_DB,
        connectTimeout: EventBus.CONNECT_TIMEOUT_MS,
      },
      defaultJobOptions: EventBus.defaultJobOptions,
    };
    const queues = {
      events: new Queue('events', options),
      ingestion: new Queue('ingestion', options),
    };
    for (const queue of Object.values(queues)) {
      // An `error` event with no listener is an uncaught exception: a Redis blip would kill the process.
      queue.on('error', (error: Error) => console.error(`queue ${queue.name}:`, error.message));
    }
    return new EventBus(queues);
  }

  /** Ingestion has its own queue, so a 500 000-row import cannot starve promotion events. */
  async publish<N extends EventName>(
    name: N,
    payload: EventPayload<N>,
    options?: JobsOptions,
  ): Promise<Job> {
    return this.bounded(
      `publish("${name}")`,
      this.queues[queueOfEvent[name]].add(name, parseEvent(name, payload), options),
    );
  }

  /** `now` is a parameter so one clock decides: PostgreSQL's, never the process's. */
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
  async removePromotionBoundaries(
    promotionId: number,
  ): Promise<Record<PromotionBoundary, number>> {
    const [activate, expire] = await this.bounded(
      `removePromotionBoundaries(${promotionId})`,
      Promise.all([
        this.queues.events.remove(EventBus.boundaryJobId(promotionId, 'activate')),
        this.queues.events.remove(EventBus.boundaryJobId(promotionId, 'expire')),
      ]),
    );
    return { activate, expire };
  }

  /**
   * The queue itself, for inspection and administration: a worker's own
   * connection, a test asserting job state, an operator draining the dead-letter
   * set. Publishing goes through `publish`, which is what applies the payload
   * parse and the timeout.
   */
  queueFor(name: QueueName): Queue {
    return this.queues[name];
  }

  /** Removes every job on both queues. For a test between cases, not for a request. */
  async clear(): Promise<void> {
    await Promise.all(Object.values(this.queues).map((queue) => queue.obliterate({ force: true })));
  }

  /** Closing does not drain: an in-flight operation is rejected with the connection
   *  under it, so `SIGTERM` stops the producers first. What it buys is the socket,
   *  which otherwise holds the event loop open until the orchestrator sends KILL. */
  async close(): Promise<void> {
    await Promise.all(Object.values(this.queues).map((queue) => queue.close()));
  }

  /**
   * Write-once per id: BullMQ ignores an `add` for an id it still holds, and the
   * returned `Job` then describes the request, not what is stored. Nothing may
   * depend on a fired job still being resident; ADR-0007 says what the reconciler
   * owes here.
   */
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
