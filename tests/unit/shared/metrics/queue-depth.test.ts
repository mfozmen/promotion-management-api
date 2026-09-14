import { beforeEach, describe, expect, it, vi } from 'vitest';
import { metricsRegistry } from '@src/shared/metrics/metrics-registry.js';
import { queueDepth } from '@src/shared/metrics/queue-depth.js';

describe('queueDepth', () => {
  it('reads both counts at scrape time, once per queue', async () => {
    // A gauge set on a timer reports the last moment the timer fired, which is an
    // interval Prometheus is already choosing.
    const inspect = vi.fn(() => ({
      getWaitingCount: () => Promise.resolve(3),
      getFailedCount: () => Promise.resolve(1),
    }));
    const gauges = queueDepth({ inspect }, ['promotions', 'ingestion']);

    expect(gauges).toHaveLength(2);

    const scrape = await metricsRegistry.metrics();

    expect(scrape).toContain('queue_waiting_jobs{queue="promotions"} 3');
    expect(scrape).toContain('queue_failed_jobs{queue="ingestion"} 1');
    // Two queues, two metrics, and nothing read before the scrape asked.
    expect(inspect).toHaveBeenCalledTimes(4);
  });
});

describe('queueDepth when Redis will not answer', () => {
  // One registry per process, so a second registration of the same name throws;
  // each case here owns the names it creates.
  beforeEach(() => metricsRegistry.clear());

  it('reports -1 rather than zero, because zero is an empty queue', async () => {
    // An alert has to tell "nothing queued" from "nobody could ask", and a scrape
    // that hangs is the one an operator reaches for when Redis is what is wrong.
    vi.useFakeTimers();
    queueDepth(
      {
        inspect: () => ({
          getWaitingCount: () => new Promise<number>(() => undefined),
          getFailedCount: () => Promise.reject(new Error('connection is closed')),
        }),
      },
      ['maintenance'],
    );

    const scrape = metricsRegistry.metrics();
    await vi.advanceTimersByTimeAsync(2_000);
    vi.useRealTimers();

    expect(await scrape).toContain('queue_waiting_jobs{queue="maintenance"} -1');
    expect(await scrape).toContain('queue_failed_jobs{queue="maintenance"} -1');
  });
});
