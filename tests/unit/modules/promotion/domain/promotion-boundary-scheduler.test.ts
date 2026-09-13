import type { Job, JobsOptions } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { PromotionBoundaryScheduler } from '@src/modules/promotion/domain/promotion-boundary-scheduler.js';
import type { QueueName } from '@src/shared/queue/queue-name.js';

type Published = { payload: { promotionId: number }; options?: JobsOptions };
type Removed = { name: QueueName; jobId: string };

/** A queue that records rather than connects: the ids and the delay are what this owns. */
class RecordingQueue {
  readonly published: Published[] = [];
  readonly removed: Removed[] = [];

  constructor(private readonly removalCodes: number[] = []) {}

  async publish(
    _name: 'promotion.changed',
    payload: { promotionId: number },
    options?: JobsOptions,
  ): Promise<Job> {
    this.published.push({ payload, options });
    return { id: options?.jobId } as Job;
  }

  async remove(name: QueueName, jobId: string): Promise<number> {
    this.removed.push({ name, jobId });
    return this.removalCodes.shift() ?? 1;
  }
}

const at = new Date('2026-09-13T00:00:00.000Z');

describe('PromotionBoundaryScheduler', () => {
  it.each([
    ['activate', 'promo:5:activate'],
    ['expire', 'promo:5:expire'],
  ] as const)('gives a %s boundary the write-once id %s', async (boundary, jobId) => {
    const queue = new RecordingQueue();

    const job = await new PromotionBoundaryScheduler(queue).schedule(5, boundary, at, at);

    expect(job.id).toBe(jobId);
    expect(queue.published[0]?.payload).toEqual({ promotionId: 5 });
  });

  it.each([
    ['one millisecond before the boundary', 1, 1],
    ['exactly at the boundary', 0, 0],
    // Negative delays are how BullMQ would read a boundary already passed; floor at zero.
    ['a day after the boundary', -86_400_000, 0],
  ])('delays a boundary scheduled %s', async (_case, offsetMs, expected) => {
    const queue = new RecordingQueue();
    const now = new Date(at.getTime() - offsetMs);

    await new PromotionBoundaryScheduler(queue).schedule(8, 'expire', at, now);

    expect(queue.published[0]?.options?.delay).toBe(expected);
  });

  it('cancels both boundaries on the promotions queue and reports each code', async () => {
    const queue = new RecordingQueue([1, 0]);

    expect(await new PromotionBoundaryScheduler(queue).cancel(7)).toEqual({
      activate: 1,
      expire: 0,
    });
    expect(queue.removed).toEqual([
      { name: 'promotions', jobId: 'promo:7:activate' },
      { name: 'promotions', jobId: 'promo:7:expire' },
    ]);
  });
});
