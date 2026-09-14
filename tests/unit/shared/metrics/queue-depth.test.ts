import { describe, expect, it, vi } from 'vitest';
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
    queueDepth({ inspect }, ['promotions', 'ingestion']);

    const scrape = await metricsRegistry.metrics();

    expect(scrape).toContain('queue_waiting_jobs{queue="promotions"} 3');
    expect(scrape).toContain('queue_failed_jobs{queue="ingestion"} 1');
    // Two queues, two metrics, and nothing read before the scrape asked.
    expect(inspect).toHaveBeenCalledTimes(4);
  });
});
