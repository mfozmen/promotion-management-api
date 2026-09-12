import { AsyncLocalStorage } from 'node:async_hooks';
import { Queue, type Job, type JobsOptions } from 'bullmq';
import {
  parseEvent,
  queueOfEvent,
  type EventName,
  type EventPayload,
  type QueueName,
} from './events.js';

/** Database 0 holds the read model; keeping the queue on its own logical database means neither can destroy the other. */
export const QUEUE_DB = 1;

/** `removeOnFail: false` is what makes the failed set the dead-letter queue. */
export const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: false,
} as const satisfies JobsOptions;

export type Queues = Record<QueueName, Queue>;

export function createQueues(redisUrl: string): Queues {
  const options = { connection: { url: redisUrl, db: QUEUE_DB }, defaultJobOptions };
  return { events: new Queue('events', options), ingestion: new Queue('ingestion', options) };
}

const transactionScope = new AsyncLocalStorage<true>();

/**
 * Wraps a PostgreSQL transaction body so that enqueueing inside it throws. A job
 * enqueued before the commit can be consumed before its row is visible and
 * survives a rollback, so producers enqueue after the commit returns and leave
 * the crash-in-between window to the reconciler.
 *
 * The guard is opt-in: it sees only transactions whose body is wrapped, and an
 * unawaited promise started inside the body inherits the scope and trips it.
 * Wrapping once inside the database module's `transaction()` helper, when that
 * lands, would remove both limitations.
 */
export function withinTransaction<T>(body: () => T): T {
  return transactionScope.run(true, body);
}

export async function enqueue<N extends EventName>(
  queues: Queues,
  name: N,
  payload: EventPayload<N>,
  options?: JobsOptions,
): Promise<Job> {
  if (transactionScope.getStore() !== undefined) {
    throw new Error(
      `enqueue("${name}") must happen after the PostgreSQL commit, never inside the transaction`,
    );
  }
  return queues[queueOfEvent[name]].add(name, parseEvent(name, payload), options);
}

export type PromotionBoundary = 'activate' | 'expire';

/**
 * `removeOnComplete: 1000` keeps a fired boundary job resident, and BullMQ
 * ignores an `add` for a job id it still holds, so only the scheduling of a
 * future boundary may use this id. The reconciler's sweep re-emits a plain
 * `promotion.changed` with no job id instead.
 */
export function promotionBoundaryJobId(promotionId: number, boundary: PromotionBoundary): string {
  return `promo:${promotionId}:${boundary}`;
}

/** Delayed until `at`, or immediate when that instant has already passed. `now` is a parameter so one clock decides. */
export function schedulePromotionBoundary(
  queues: Queues,
  promotionId: number,
  boundary: PromotionBoundary,
  at: Date,
  now: Date,
): Promise<Job> {
  return enqueue(
    queues,
    'promotion.changed',
    { promotionId },
    {
      jobId: promotionBoundaryJobId(promotionId, boundary),
      delay: Math.max(0, at.getTime() - now.getTime()),
    },
  );
}

/**
 * Returns BullMQ's removal code per boundary: `1` when nothing blocked the
 * removal, including when there was no such job, and `0` when a worker already
 * holds the job. A cancel racing a running activate gets `0` and can log it; the
 * end state is still correct because cancel also enqueues an immediate
 * `promotion.changed`.
 */
export async function removePromotionBoundaries(
  queues: Queues,
  promotionId: number,
): Promise<Record<PromotionBoundary, number>> {
  const [activate, expire] = await Promise.all([
    queues.events.remove(promotionBoundaryJobId(promotionId, 'activate')),
    queues.events.remove(promotionBoundaryJobId(promotionId, 'expire')),
  ]);
  return { activate, expire };
}
