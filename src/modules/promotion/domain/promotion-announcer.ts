import type { Logger } from 'pino';
import type { PromotionView } from './dto/promotion-view.js';
import type { PromotionScheduler } from './promotion-scheduler.js';

/** Every step settles on its own: a sequential chain would let a boundary call
 *  that times out skip the `promotion.changed` behind it, leaving a cancelled
 *  sale priced. The row is committed by then, so a failure is logged, not raised. */
/** What the announcer needs of the queue; the queue knows nothing of promotions. */
type AnnouncementQueue = {
  publish(name: 'promotion.changed', payload: { promotionId: number }): Promise<unknown>;
};

export class PromotionAnnouncer {
  constructor(
    private readonly queue: AnnouncementQueue,
    private readonly scheduler: PromotionScheduler,
    private readonly logger: Logger,
  ) {}

  async announce(promotion: PromotionView, now: Date): Promise<void> {
    if (promotion.status !== 'active') return;

    const alreadyRunning = promotion.startsAt.getTime() <= now.getTime();

    // Only for a sale that is already running: the publish is its activation, and
    // an `activate` job on top would land a second recompute of the same category
    // milliseconds later. A scheduled sale gets that job and nothing now — an
    // immediate recompute would change no price and would queue a full-category
    // scan ahead of boundaries that are due.
    if (alreadyRunning) {
      await this.settle(
        this.queue.publish('promotion.changed', { promotionId: promotion.id }),
        promotion.id,
      );
    }

    await Promise.all([
      this.settle(
        this.scheduler.schedule(promotion.id, 'expire', promotion.endsAt, now),
        promotion.id,
      ),
      ...(alreadyRunning
        ? []
        : [
            this.settle(
              this.scheduler.schedule(promotion.id, 'activate', promotion.startsAt, now),
              promotion.id,
            ),
          ]),
    ]);
  }

  async announceCancellation(promotionId: number): Promise<void> {
    const announced = await this.settle(
      this.queue.publish('promotion.changed', { promotionId }),
      promotionId,
    );

    // Only once the cancellation is out. The `expire` job re-reads the row and
    // publishes the base price, so it is the fallback for a lost announcement;
    // removing it after a failed publish deletes the recovery with the event.
    if (announced) await this.settle(this.scheduler.cancel(promotionId), promotionId);
  }

  private async settle(work: Promise<unknown>, promotionId: number): Promise<boolean> {
    try {
      await work;

      return true;
    } catch (error) {
      this.logger.error(
        { promotionId, err: error },
        'a promotion change could not be announced; the read model stays stale until this promotion changes again',
      );

      return false;
    }
  }
}
