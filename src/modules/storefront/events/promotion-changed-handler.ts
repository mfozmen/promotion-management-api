import type { Logger } from 'pino';
import type { PromotionChanged } from '../../promotion/events/promotion-changed.js';
import type { PromotionView } from '../../promotion/domain/dto/promotion-view.js';

/** Enough of the admin repository to name a promotion's target. */
interface Promotions {
  find(id: number): Promise<PromotionView | undefined>;
}

interface CategoryProducts {
  idsInCategory(category: string, afterId: number): Promise<number[]>;
}

interface AnnouncementQueue {
  publish(name: 'product.upserted', payload: { productIds: number[] }): Promise<unknown>;
}

/** A promotion changed, so every product it covers is recomputed. The row is
 *  re-read rather than trusted from the payload: a boundary job means re-read,
 *  never activate, so one firing against a cancelled promotion republishes the
 *  base price. */
export class PromotionChangedHandler {
  constructor(
    private readonly promotions: Promotions,
    private readonly products: CategoryProducts,
    private readonly queue: AnnouncementQueue,
    private readonly logger: Logger,
  ) {}

  async handle({ promotionId }: PromotionChanged): Promise<void> {
    const promotion = await this.promotions.find(promotionId);

    if (promotion?.productId != null) {
      await this.queue.publish('product.upserted', { productIds: [promotion.productId] });
      return;
    }

    if (promotion?.category != null) {
      await this.recomputeCategory(promotion.category);
      return;
    }

    // A draft carries no target and a deleted row is not a thing this system
    // makes, so both are worth a line rather than a silent return.
    this.logger.warn(
      { promotionId },
      'promotion.changed named a promotion with no target; nothing was recomputed',
    );
  }

  /** Each page is enqueued rather than recomputed here: scanning 50 000 products
   *  inline would hold the urgent queue for the length of a flash sale, and a
   *  cancel would wait behind the sale's own rescan (ADR-0003). */
  private async recomputeCategory(category: string): Promise<void> {
    let afterId = 0;

    for (;;) {
      const productIds = await this.products.idsInCategory(category, afterId);

      if (productIds.length === 0) return;

      await this.queue.publish('product.upserted', { productIds });
      afterId = productIds[productIds.length - 1]!;
    }
  }
}
