import { beforeEach, describe, expect, it, vi } from 'vitest';
import { metricsRegistry } from '@src/shared/metrics/metrics-registry.js';
import { queueDepth } from '@src/shared/metrics/queue-depth.js';
import { captureLogger } from '../../capture-logger.js';

describe('queueDepth', () => {
  it('reads both counts at scrape time, once per queue', async () => {
    // A gauge set on a timer reports the last moment the timer fired, which is an
    // interval Prometheus is already choosing.
    const inspect = vi.fn(() => ({
      getWaitingCount: () => Promise.resolve(3),
      getFailedCount: () => Promise.resolve(1),
    }));
    const gauges = queueDepth({ inspect }, ['promotions', 'ingestion'], captureLogger().logger);

    expect(gauges).toHaveLength(2);

    const scrape = await metricsRegistry.metrics();

    expect(scrape).toContain('queue_waiting_jobs{queue="promotions"} 3');
    expect(scrape).toContain('queue_failed_jobs{queue="ingestion"} 1');
    // Two queues, two metrics, and nothing read before the scrape asked.
    expect(inspect).toHaveBeenCalledTimes(4);
  });
});

const hang = (): Promise<number> => new Promise<number>(() => undefined);

describe('queueDepth when Redis will not answer', () => {
  // One registry per process, so a second registration of the same name throws;
  // each case here owns the names it creates.
  beforeEach(() => metricsRegistry.clear());

  it('reports -1 rather than zero, and says why in the log', async () => {
    // An alert has to tell "nothing queued" from "nobody could ask", and a scrape
    // that hangs is the one an operator reaches for when Redis is what is wrong.
    // -1 says a read failed and never says which failure it was.
    vi.useFakeTimers();
    const { logger, lines } = captureLogger();
    queueDepth(
      {
        inspect: () => ({
          getWaitingCount: () => new Promise<number>(() => undefined),
          getFailedCount: () => Promise.reject(new Error('connection is closed')),
        }),
      },
      ['maintenance'],
      logger,
    );

    const scrape = metricsRegistry.metrics();
    await vi.advanceTimersByTimeAsync(2_000);
    vi.useRealTimers();

    expect(await scrape).toContain('queue_waiting_jobs{queue="maintenance"} -1');
    expect(await scrape).toContain('queue_failed_jobs{queue="maintenance"} -1');
    expect(lines.map((line) => line.msg).sort()).toEqual([
      'queue depth read failed',
      'queue depth read timed out',
    ]);
  });

  it('says it once, and says when it comes back', async () => {
    // Eight reads every five seconds is eight lines every five seconds for as long
    // as Redis is away, and the line that says why is then the one an operator
    // cannot find. The alert sends them to this log, so it has to be readable.
    const { logger, lines } = captureLogger();
    let answers = false;
    queueDepth(
      {
        inspect: () => ({
          getWaitingCount: () => (answers ? Promise.resolve(7) : Promise.reject(new Error('gone'))),
          getFailedCount: () => Promise.resolve(0),
        }),
      },
      ['promotions'],
      logger,
    );

    await metricsRegistry.metrics();
    await metricsRegistry.metrics();
    answers = true;
    const back = await metricsRegistry.metrics();

    expect(lines.map((line) => line.msg)).toEqual([
      'queue depth read failed',
      'queue depth readable again',
    ]);
    expect(back).toContain('queue_waiting_jobs{queue="promotions"} 7');
  });

  it('spends one timeout on four hung queues, not four', async () => {
    // Serially, four queues past the 2 s bound is 8 s, and Prometheus clamps a
    // scrape's timeout down to scrape_interval - so the whole endpoint is lost and
    // TargetDown pages for a process that is alive. That is the failure these
    // gauges exist to describe, arriving through them.
    vi.useFakeTimers();
    queueDepth(
      { inspect: () => ({ getWaitingCount: hang, getFailedCount: hang }) },
      ['promotions', 'products', 'ingestion', 'maintenance'],
      captureLogger().logger,
    );

    const scrape = metricsRegistry.metrics();
    await vi.advanceTimersByTimeAsync(2_000);
    vi.useRealTimers();

    // Resolved after one bound elapsed: four serial reads would still be waiting.
    expect(await scrape).toContain('queue_waiting_jobs{queue="ingestion"} -1');
  });
});
