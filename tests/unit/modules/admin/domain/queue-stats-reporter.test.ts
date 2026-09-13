import { describe, expect, it } from 'vitest';
import { QueueStatsReporter } from '@src/modules/admin/domain/queue-stats-reporter.js';
import type { QueueName } from '@src/shared/queue/queue-name.js';

const NOW = new Date('2026-09-13T18:00:00.000Z');
const TIMEOUT_MS = 1_000;

interface Counts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  oldestWaitingAt?: string;
}

/** Records what was asked of it, so the reporter's read pattern is assertable, not just its sums. */
function queueHolding(queues: Record<string, Counts>) {
  const calls: string[] = [];

  return {
    calls,
    names: (): QueueName[] => Object.keys(queues) as QueueName[],
    inspect: (name: QueueName) => {
      const counts = queues[name] ?? { waiting: 0, active: 0, delayed: 0, failed: 0 };

      return {
        getWaitingCount: async () => Promise.resolve(counts.waiting),
        getActiveCount: async () => Promise.resolve(counts.active),
        getDelayedCount: async () => Promise.resolve(counts.delayed),
        getFailedCount: async () => Promise.resolve(counts.failed),
        getJobs: async (types: ['waiting'], start: number, end: number, asc: boolean) => {
          calls.push(`${name}:${types.join(',')}:${String(start)}-${String(end)}:${String(asc)}`);
          const at = counts.oldestWaitingAt;

          return Promise.resolve(at === undefined ? [] : [{ timestamp: Date.parse(at) }]);
        },
      };
    },
  };
}

describe('QueueStatsReporter', () => {
  it('reports every queue the bus holds, counts and all', async () => {
    const queue = queueHolding({
      promotions: { waiting: 2, active: 1, delayed: 7, failed: 0 },
      ingestion: { waiting: 0, active: 0, delayed: 0, failed: 3 },
    });

    const stats = await new QueueStatsReporter(queue, () => NOW, TIMEOUT_MS).report();

    expect(stats).toEqual([
      {
        queue: 'promotions',
        waiting: 2,
        active: 1,
        delayed: 7,
        failed: 0,
        oldestWaitingAgeSeconds: null,
      },
      {
        queue: 'ingestion',
        waiting: 0,
        active: 0,
        delayed: 0,
        failed: 3,
        oldestWaitingAgeSeconds: null,
      },
    ]);
  });

  it('ages the oldest waiting job against the clock it was given', async () => {
    const queue = queueHolding({
      promotions: {
        waiting: 1,
        active: 0,
        delayed: 0,
        failed: 0,
        oldestWaitingAt: '2026-09-13T17:59:30.000Z',
      },
    });

    const [stats] = await new QueueStatsReporter(queue, () => NOW, TIMEOUT_MS).report();

    expect(stats?.oldestWaitingAgeSeconds).toBe(30);
  });

  it('asks for one job, the oldest, rather than the waiting list', async () => {
    // A queue at its 10 000-job alert threshold would otherwise be read into memory
    // to find a timestamp (REVIEW.md 6.21).
    const queue = queueHolding({ promotions: { waiting: 9, active: 0, delayed: 0, failed: 0 } });

    await new QueueStatsReporter(queue, () => NOW, TIMEOUT_MS).report();

    expect(queue.calls).toEqual(['promotions:waiting:0-0:true']);
  });

  it('reports no age rather than zero when nothing is waiting', async () => {
    // Zero would read as "a job has been waiting no time at all", which is a different fact
    // from "there is no job", and the alert on queue age would never fire on an empty queue.
    const queue = queueHolding({ promotions: { waiting: 0, active: 0, delayed: 0, failed: 0 } });

    const [stats] = await new QueueStatsReporter(queue, () => NOW, TIMEOUT_MS).report();

    expect(stats?.oldestWaitingAgeSeconds).toBeNull();
  });

  it('floors a sub-second age rather than reporting a fraction', async () => {
    const queue = queueHolding({
      promotions: {
        waiting: 1,
        active: 0,
        delayed: 0,
        failed: 0,
        oldestWaitingAt: '2026-09-13T17:59:59.400Z',
      },
    });

    const [stats] = await new QueueStatsReporter(queue, () => NOW, TIMEOUT_MS).report();

    expect(stats?.oldestWaitingAgeSeconds).toBe(0);
  });

  it('never reports a negative age when a job carries a clock ahead of ours', async () => {
    // Redis and this process need not agree; a negative age would read as a queue draining
    // into the future and would break any comparison the alert rule makes.
    const queue = queueHolding({
      promotions: {
        waiting: 1,
        active: 0,
        delayed: 0,
        failed: 0,
        oldestWaitingAt: '2026-09-13T18:00:05.000Z',
      },
    });

    const [stats] = await new QueueStatsReporter(queue, () => NOW, TIMEOUT_MS).report();

    expect(stats?.oldestWaitingAgeSeconds).toBe(0);
  });

  it('gives up rather than hanging when Redis does not answer', async () => {
    // The reads carry no bound of their own: a non-blocking BullMQ connection retries for
    // minutes before rejecting, and this endpoint is the one an operator reaches for at
    // exactly that moment. Proved against a read that never settles, not a synthetic
    // rejection, because the control being tested is the timeout (REVIEW.md 7.4b).
    const stalled = {
      names: (): QueueName[] => ['promotions'],
      inspect: () => ({
        getWaitingCount: () => new Promise<number>(() => undefined),
        getActiveCount: () => new Promise<number>(() => undefined),
        getDelayedCount: () => new Promise<number>(() => undefined),
        getFailedCount: () => new Promise<number>(() => undefined),
        getJobs: () => new Promise<{ timestamp: number }[]>(() => undefined),
      }),
    };

    await expect(new QueueStatsReporter(stalled, () => NOW, 20).report()).rejects.toThrow(
      'queue stats did not answer within 20 ms',
    );
  });

  it('reports an empty list when the bus holds no queues', async () => {
    const stats = await new QueueStatsReporter(queueHolding({}), () => NOW, TIMEOUT_MS).report();

    expect(stats).toEqual([]);
  });
});
