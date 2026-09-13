import type { Logger } from 'pino';
import type { Enqueue } from '../../../shared/enqueue.js';
import type { PromotionBoundaries } from '../../../shared/promotion-boundaries.js';

/**
 * The boundaries go first: a delayed activate that fires after the cancel would
 * publish a price for a promotion nobody is running any more.
 *
 * Both steps are swallowed together, and that symmetry is the point. The row is
 * already `cancelled`; letting an unreachable Redis turn a committed
 * cancellation into a 500 would tell the admin their write failed when it did
 * not, and — worse — would skip the `promotion.changed` that takes the discount
 * off the storefront, leaving the sale price served until the reconciler sweeps.
 */
export async function announceCancellation(
  promotionId: number,
  deps: { enqueue: Enqueue; boundaries: PromotionBoundaries; log: Logger },
): Promise<void> {
  try {
    await deps.boundaries.remove(promotionId);
    await deps.enqueue('promotion.changed', { promotionId });
  } catch (error) {
    deps.log.error(
      { promotionId, error: { message: error instanceof Error ? error.message : 'unknown' } },
      'promotion.changed could not be announced; the reconciler will repair',
    );
  }
}
