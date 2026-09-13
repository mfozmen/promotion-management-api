import { describe, expect, it } from 'vitest';
import { BoundarySweep } from '@src/workers/reconciler/boundary-sweep.js';
import { captureLogger } from '../../capture-logger.js';

const WINDOW_END = new Date('2026-09-14T03:00:00.000Z');

/** The repository, stubbed at the seam the sweep actually uses. */
function repositoryHolding(ids: number[], over: Record<string, unknown> = {}) {
  const advanced: Date[] = [];

  return {
    advanced,
    crossedSince: () => Promise.resolve({ promotionIds: ids, windowEnd: WINDOW_END }),
    advanceWatermark: (to: Date) => {
      advanced.push(to);

      return Promise.resolve();
    },
    ...over,
  };
}

const recordingQueue = () => {
  const published: number[] = [];

  return {
    published,
    publish: (_name: 'promotion.changed', payload: { promotionId: number }) => {
      published.push(payload.promotionId);

      return Promise.resolve();
    },
  };
};

describe('BoundarySweep', () => {
  it('re-emits one event per promotion whose boundary was crossed', async () => {
    const { logger } = captureLogger();
    const repository = repositoryHolding([7, 9]);
    const queue = recordingQueue();

    await new BoundarySweep(repository, queue, logger).run();

    expect(queue.published).toEqual([7, 9]);
  });

  it('advances the watermark to the instant the window was read at, not the process clock', async () => {
    // The window and the watermark come from the same database statement, so a
    // process clock that drifts cannot open a gap the next sweep skips over.
    const { logger } = captureLogger();
    const repository = repositoryHolding([7]);

    await new BoundarySweep(repository, recordingQueue(), logger).run();

    expect(repository.advanced).toEqual([WINDOW_END]);
  });

  it('leaves the watermark where it was when an emission fails', async () => {
    // The window is retried rather than skipped: `promotion.changed` carries only an
    // id and its handler re-reads, so a repeat costs a recompute and a skip costs a
    // stale price nothing else repairs.
    const { logger, lines } = captureLogger();
    const repository = repositoryHolding([7, 9]);
    const failing = {
      publish: (_name: 'promotion.changed', payload: { promotionId: number }) =>
        payload.promotionId === 9
          ? Promise.reject(new Error('Redis is down'))
          : Promise.resolve(),
    };

    await new BoundarySweep(repository, failing, logger).run();

    expect(repository.advanced).toEqual([]);
    expect(lines.some((line) => String(line.msg).includes('sweep did not complete'))).toBe(true);
  });

  it('advances the watermark over an empty window rather than letting it fall behind', async () => {
    // Nothing crossed, so there is nothing to emit — but a watermark that only moves
    // on a non-empty window grows the next window without bound.
    const { logger } = captureLogger();
    const repository = repositoryHolding([]);
    const queue = recordingQueue();

    await new BoundarySweep(repository, queue, logger).run();

    expect(queue.published).toEqual([]);
    expect(repository.advanced).toEqual([WINDOW_END]);
  });
});
