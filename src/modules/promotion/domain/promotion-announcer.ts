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

    await this.settle(
      this.queue.publish('promotion.changed', { promotionId: promotion.id }),
      promotion.id,
    );

    // A promotion already running needs no activation job: the publish above is
    // the activation. Scheduling one anyway gives it `delay: 0`, so two
    // `promotion.changed` jobs land within milliseconds and each keyset-scans
    // the same category — two full rescans of 50 000 products.
    const alreadyRunning = promotion.startsAt.getTime() <= now.getTime();

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
    await this.settle(this.queue.publish('promotion.changed', { promotionId }), promotionId);
    await this.settle(this.scheduler.cancel(promotionId), promotionId);
  }

  private async settle(work: Promise<unknown>, promotionId: number): Promise<void> {
    try {
      await work;
    } catch (error) {
      this.logger.error(
        { promotionId, err: error },
        'a promotion change could not be announced; the read model stays stale until this promotion changes again',
      );
    }
  }
}
