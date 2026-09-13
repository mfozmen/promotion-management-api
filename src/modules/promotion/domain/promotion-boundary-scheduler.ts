import type { Job, JobsOptions } from 'bullmq';
import type { QueueName } from '../../../shared/queue/queue-name.js';
import type { PromotionBoundary } from './dto/promotion-boundary.js';

/** What the scheduler needs of the queue; the queue itself knows nothing of promotions. */
type BoundaryQueue = {
  publish(
    name: 'promotion.changed',
    payload: { promotionId: number },
    options?: JobsOptions,
  ): Promise<Job>;
  remove(name: QueueName, jobId: string): Promise<number>;
};

/** The promotion module's delayed boundary jobs: their ids, their delay and their removal. */
export class PromotionBoundaryScheduler {
  private static readonly QUEUE: QueueName = 'promotions';

  constructor(private readonly queue: BoundaryQueue) {}

  /**
   * `now` is a parameter so one clock decides: PostgreSQL's, never the process's. Write-once
   * per id: BullMQ ignores an `add` for an id it still holds, and the returned `Job` then
   * describes the request rather than what is stored. ADR-0007.
   */
  async schedule(
    promotionId: number,
    boundary: PromotionBoundary,
    at: Date,
    now: Date,
  ): Promise<Job> {
    return this.queue.publish(
      'promotion.changed',
      { promotionId },
      {
        jobId: PromotionBoundaryScheduler.jobId(promotionId, boundary),
        delay: Math.max(0, at.getTime() - now.getTime()),
      },
    );
  }

  /**
   * A cancel racing a running activate gets `0` for that boundary but still ends correct:
   * cancel publishes `promotion.changed` anyway.
   */
  async cancel(promotionId: number): Promise<Record<PromotionBoundary, number>> {
    const [activate, expire] = await Promise.all([
      this.remove(promotionId, 'activate'),
      this.remove(promotionId, 'expire'),
    ]);
    return { activate, expire };
  }

  private static jobId(promotionId: number, boundary: PromotionBoundary): string {
    return `promo:${promotionId}:${boundary}`;
  }

  private async remove(promotionId: number, boundary: PromotionBoundary): Promise<number> {
    return this.queue.remove(
      PromotionBoundaryScheduler.QUEUE,
      PromotionBoundaryScheduler.jobId(promotionId, boundary),
    );
  }
}
