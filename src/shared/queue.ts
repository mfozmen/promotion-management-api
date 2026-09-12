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
 * A job enqueued before the commit can be consumed before its row is visible and
 * survives a rollback. Opt-in: only wrapped bodies are seen, and an unawaited
 * promise started inside one trips it too. Wrapping `transaction()` fixes both.
 */
export function withinTransaction<T>(body: () => T): T {
  return transactionScope.run(true, body);
}

function assertOutsideTransaction(operation: string): void {
  if (transactionScope.getStore() !== undefined) {
    throw new Error(
      `${operation} must happen after the PostgreSQL commit, never inside the transaction`,
    );
  }
}

export async function enqueue<N extends EventName>(
  queues: Queues,
  name: N,
  payload: EventPayload<N>,
  options?: JobsOptions,
): Promise<Job> {
  assertOutsideTransaction(`enqueue("${name}")`);
  return queues[queueOfEvent[name]].add(name, parseEvent(name, payload), options);
}

export type PromotionBoundary = 'activate' | 'expire';

/**
 * Write-once per id: BullMQ ignores an `add` for an id it still holds, and the
 * returned `Job` then describes the request, not what is stored. The reconciler's
 * sweep re-emits `promotion.changed` with no job id instead.
 */
export function promotionBoundaryJobId(promotionId: number, boundary: PromotionBoundary): string {
  return `promo:${promotionId}:${boundary}`;
}

/** `now` is a parameter so one clock decides: PostgreSQL's, never the process's. */
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
 * Barred inside a transaction like `enqueue`: a rollback cannot undo a removal.
 * BullMQ's codes: `1` when nothing blocked it, including when there was no such
 * job, `0` when a worker already holds it. A cancel racing a running activate
 * gets `0` but still ends correct: cancel enqueues `promotion.changed`.
 */
export async function removePromotionBoundaries(
  queues: Queues,
  promotionId: number,
): Promise<Record<PromotionBoundary, number>> {
  assertOutsideTransaction(`removePromotionBoundaries(${promotionId})`);
  const [activate, expire] = await Promise.all([
    queues.events.remove(promotionBoundaryJobId(promotionId, 'activate')),
    queues.events.remove(promotionBoundaryJobId(promotionId, 'expire')),
  ]);
  return { activate, expire };
}
