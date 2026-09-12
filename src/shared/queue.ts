import { AsyncLocalStorage } from 'node:async_hooks';
import { Queue, type Job, type JobsOptions } from 'bullmq';
import {
  parseEvent,
  queueOfEvent,
  type EventName,
  type EventPayload,
  type QueueName,
} from './events.js';

/**
 * Redis logical database 1 carries BullMQ. Database 0 is the read model and
 * nothing in this module may reach it, so no queue maintenance can destroy the
 * read model and no read-model rebuild can destroy queued work (REVIEW.md 5.4,
 * ADR-0007).
 */
export const QUEUE_DB = 1;

/** Design section 6: three attempts, exponential backoff from 1 s, the failed set kept as the dead-letter queue. */
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
 * Marks a PostgreSQL transaction body. A job enqueued before the commit can be
 * consumed before its row is visible and survives a rollback, so producers
 * enqueue after the commit returns and rely on the reconciler for the
 * crash-in-between window (REVIEW.md 3.4, design section 6). Wrapping the
 * transaction body in this turns that ordering mistake into a loud failure
 * instead of a rare, silent stale read.
 *
 * ponytail: the guard is opt-in — it only sees transactions whose body is
 * wrapped, and an unawaited promise started inside the body would inherit the
 * scope and trip it. The upgrade path is to wrap once inside the database
 * module's `transaction()` helper when that lands, so no caller can forget.
 */
export function withinTransaction<T>(body: () => T): T {
  return transactionScope.run(true, body);
}

/** Validates the payload, then enqueues it on the queue the design assigns to that event. */
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
 * The deterministic job id of a promotion boundary, so duplicates deduplicate and a cancel can remove it.
 *
 * ponytail: `removeOnComplete: 1000` keeps a completed boundary job resident,
 * and BullMQ ignores an `add` for a job id it still holds. Anything re-emitting
 * a boundary after it has fired — the reconciler's watermark sweep — therefore
 * enqueues a plain `promotion.changed` with no job id, which is what the design
 * specifies; only the scheduling of a future boundary uses this id.
 */
export function promotionBoundaryJobId(promotionId: number, boundary: PromotionBoundary): string {
  return `promo:${promotionId}:${boundary}`;
}

/**
 * Schedules `promotion.changed` for a promotion boundary: delayed until `at`,
 * or immediately when that instant has already passed. `now` is injected so one
 * clock decides (REVIEW.md 1.7).
 */
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
 * Removes both boundary jobs of a cancelled promotion by their deterministic ids.
 *
 * Returns BullMQ's removal code per boundary: `1` when nothing blocked the
 * removal (including when there was no such job) and `0` when the job was
 * locked because a worker had already picked it up. A cancel that races a
 * running activate gets `0` and can log it; the end state is still correct
 * because cancel also enqueues an immediate `promotion.changed` (design section
 * 6), but a silent no-op would hide the race (REVIEW.md 3.1, 9.1).
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
