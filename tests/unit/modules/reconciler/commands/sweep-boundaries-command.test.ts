import { describe, expect, it } from 'vitest';
import { SweepBoundariesCommand } from '@src/modules/reconciler/commands/sweep-boundaries-command.js';
import { captureLogger } from '../../../capture-logger.js';

const SINCE = new Date('2026-09-14T02:50:00.000Z');
const WINDOW_END = new Date('2026-09-14T03:00:00.000Z');

function boundariesHolding(promotionIds: number[], advance = () => Promise.resolve(true)) {
  const advanced: [Date, Date][] = [];

  return {
    advanced,
    crossedSince: () => Promise.resolve({ since: SINCE, windowEnd: WINDOW_END, promotionIds }),
    advance: (from: Date, to: Date) => {
      advanced.push([from, to]);

      return advance();
    },
  };
}

const recordingQueue = () => {
  const jobs: { promotionId: number; jobId?: string }[] = [];

  return {
    jobs,
    publish: (
      _name: 'promotion.changed',
      payload: { promotionId: number },
      options?: { jobId?: string },
    ) => {
      jobs.push({ promotionId: payload.promotionId, jobId: options?.jobId });

      return Promise.resolve();
    },
  };
};

describe('SweepBoundariesCommand', () => {
  it('re-emits one event per promotion and advances from the mark it started at', async () => {
    const { logger } = captureLogger();
    const boundaries = boundariesHolding([7, 9]);
    const queue = recordingQueue();

    await new SweepBoundariesCommand(boundaries, queue, logger).execute();

    expect(queue.jobs.map((job) => job.promotionId)).toEqual([7, 9]);
    expect(boundaries.advanced).toEqual([[SINCE, WINDOW_END]]);
  });

  it('names each job after the watermark, so a re-read of one window recomputes once', async () => {
    // The window's end is `now()` less the commit lag and moves on every read. Named
    // after it, a second pass over a window whose watermark never advanced would
    // enqueue a fresh id per promotion and recompute every category again.
    const { logger } = captureLogger();
    const queue = recordingQueue();
    const later = {
      ...boundariesHolding([7]),
      crossedSince: () =>
        Promise.resolve({
          since: SINCE,
          windowEnd: new Date('2026-09-14T03:05:00.000Z'),
          promotionIds: [7],
        }),
    };

    await new SweepBoundariesCommand(boundariesHolding([7]), queue, logger).execute();
    await new SweepBoundariesCommand(later, queue, logger).execute();

    const expected = `sweep:7:${String(SINCE.getTime())}`;
    expect(queue.jobs.map((job) => job.jobId)).toEqual([expected, expected]);
  });

  it('raises rather than reporting a swept window when an emission fails', async () => {
    // The job must fail so BullMQ retries it: a sweep that repaired nothing and
    // returned looks exactly like a window with no boundaries in it.
    const { logger } = captureLogger();
    const boundaries = boundariesHolding([7, 9]);
    const failing = {
      publish: (_n: 'promotion.changed', payload: { promotionId: number }) =>
        payload.promotionId === 9 ? Promise.reject(new Error('Redis is down')) : Promise.resolve(),
    };

    await expect(new SweepBoundariesCommand(boundaries, failing, logger).execute()).rejects.toThrow(
      'Redis is down',
    );
    expect(boundaries.advanced).toEqual([]);
  });

  it('says so rather than failing when another sweep took the watermark first', async () => {
    const { logger, lines } = captureLogger();
    const boundaries = boundariesHolding([7], () => Promise.resolve(false));

    await new SweepBoundariesCommand(boundaries, recordingQueue(), logger).execute();

    expect(lines.some((line) => String(line.msg).includes('will be read again'))).toBe(true);
  });

  it('advances over an empty window rather than letting the next one grow', async () => {
    const { logger } = captureLogger();
    const boundaries = boundariesHolding([]);

    await new SweepBoundariesCommand(boundaries, recordingQueue(), logger).execute();

    expect(boundaries.advanced).toEqual([[SINCE, WINDOW_END]]);
  });
});
