import type { Logger } from 'pino';
import type { Publish } from '../../../events/publish.js';
import type { PromotionView } from './dto/promotion-view.js';
import type { PromotionScheduler } from './promotion-scheduler.js';

/**
 * Every step is attempted on its own and a failure is logged rather than
 * raised: the row is committed by the time any of this runs, so telling the
 * admin their write failed would be false. A sequential chain would let the
 * first failure take the rest with it — a boundary call that times out skipping
 * the `promotion.changed` behind it, leaving a cancelled sale priced.
 *
 * The line carries the promotion id rather than the request id: what repairs a
 * lost event is a recompute for that promotion, and nothing in this class runs
 * inside a request.
 */
export class PromotionAnnouncer {
  constructor(
    private readonly publish: Publish,
    private readonly scheduler: PromotionScheduler,
    private readonly logger: Logger,
  ) {}

  /** A draft has no target and no boundaries; it changes no price. */
  async announce(promotion: PromotionView, now: Date): Promise<void> {
    if (promotion.status !== 'active') return;

    await this.settle(
      this.publish('promotion.changed', { promotionId: promotion.id }),
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

  /**
   * The event goes first and the boundary removal follows. Removing the delayed
   * jobs is hygiene: a boundary job carries `{ promotionId }` and its handler
   * recomputes from PostgreSQL, so one that fires for a cancelled promotion
   * reads the cancelled row and publishes the base price.
   */
  async announceCancellation(promotionId: number): Promise<void> {
    await this.settle(this.publish('promotion.changed', { promotionId }), promotionId);
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
