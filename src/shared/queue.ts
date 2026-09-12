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

/**
 * ioredis reconnects for ever and BullMQ's `add` waits for it, so an unreachable
 * Redis hangs the request that already committed. The race cancels nothing, so a
 * timed-out operation may still land: a fast failure, not a known outcome.
 */
export const QUEUE_OPERATION_TIMEOUT_MS = 2_000;

export function createQueues(redisUrl: string): Queues {
  const options = {
    connection: { url: redisUrl, db: QUEUE_DB, connectTimeout: QUEUE_OPERATION_TIMEOUT_MS },
    defaultJobOptions,
  };
  const queues = {
    events: new Queue('events', options),
    ingestion: new Queue('ingestion', options),
  };
  for (const queue of Object.values(queues)) {
    // An `error` event with no listener is an uncaught exception: a Redis blip would kill the process.
    queue.on('error', (error: Error) => console.error(`queue ${queue.name}:`, error.message));
  }
  return queues;
}

const bounded = async <T>(operation: string, work: Promise<T>): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${operation} did not confirm within ${QUEUE_OPERATION_TIMEOUT_MS} ms; it may still land`,
              ),
            ),
          QUEUE_OPERATION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // The loser still settles, and an unhandled rejection would take the process down.
    work.catch(() => undefined);
  }
};

/** Closing does not drain: an in-flight operation is rejected with the connection
 *  under it, so `SIGTERM` stops the producers first. What it buys is the socket,
 *  which otherwise holds the event loop open until the orchestrator sends KILL. */
export async function closeQueues(queues: Queues): Promise<void> {
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
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
  return bounded(
    `enqueue("${name}")`,
    queues[queueOfEvent[name]].add(name, parseEvent(name, payload), options),
  );
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
  const [activate, expire] = await bounded(
    `removePromotionBoundaries(${promotionId})`,
    Promise.all([
      queues.events.remove(promotionBoundaryJobId(promotionId, 'activate')),
      queues.events.remove(promotionBoundaryJobId(promotionId, 'expire')),
    ]),
  );
  return { activate, expire };
}
