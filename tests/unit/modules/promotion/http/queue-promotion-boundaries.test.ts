import { describe, expect, it } from 'vitest';
import type { EventBus } from '@src/shared/event-bus.js';
import { QueuePromotionBoundaries } from '@src/modules/promotion/http/queue-promotion-boundaries.js';

/**
 * This adapter is the gap between a handler and the event bus, and `src/server.ts`
 * is the one place that wires it — a file excluded from coverage, so nothing but
 * this test says the wiring passes what it claims to.
 *
 * The job id and the delay are the bus's contract rather than the adapter's, and
 * `event-bus.test.ts` pins those against a real Redis.
 */
function recordingBus() {
  const scheduled: { promotionId: number; boundary: string; at: Date; now: Date }[] = [];
  const removed: number[] = [];
  const bus = {
    schedulePromotionBoundary: (promotionId: number, boundary: string, at: Date, now: Date) => {
      scheduled.push({ promotionId, boundary, at, now });
      return Promise.resolve({});
    },
    removePromotionBoundaries: (promotionId: number) => {
      removed.push(promotionId);
      return Promise.resolve({ activate: 1, expire: 1 });
    },
  } as unknown as EventBus;
  return { bus, scheduled, removed };
}

describe('QueuePromotionBoundaries', () => {
  it('passes the boundary, the instant and the clock through untouched', async () => {
    const { bus, scheduled } = recordingBus();
    const now = new Date('2026-09-13T00:00:00.000Z');
    const at = new Date('2026-09-13T01:00:00.000Z');

    await new QueuePromotionBoundaries(bus).schedule(7, 'activate', at, now);

    expect(scheduled).toEqual([{ promotionId: 7, boundary: 'activate', at, now }]);
  });

  it('asks the bus to drop both boundary jobs for a promotion', async () => {
    const { bus, removed } = recordingBus();

    await new QueuePromotionBoundaries(bus).remove(7);

    expect(removed).toEqual([7]);
  });
});
