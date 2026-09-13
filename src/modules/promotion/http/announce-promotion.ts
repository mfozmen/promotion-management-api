import type { Logger } from 'pino';
import type { Enqueue } from '../../../shared/enqueue.js';
import type { PromotionBoundaries } from '../../../shared/promotion-boundaries.js';
import type { PromotionView } from '../domain/promotion-view.js';

/**
 * One event covers create, assign, cancel and both boundaries: the read-model
 * handler recomputes the affected products and never asks why the promotion
 * changed, so five names would be five handlers with one body. It is also what
 * lets the reconciler re-emit a missed boundary idempotently (spec section 6).
 *
 * A failure here is logged and swallowed. The row is committed; losing the
 * event costs read-model freshness until the reconciler sweeps, which is a
 * smaller failure than telling the admin their write did not happen.
 */
export async function announcePromotion(
  promotion: PromotionView,
  now: Date,
  deps: { enqueue: Enqueue; boundaries: PromotionBoundaries; log: Logger },
): Promise<void> {
  try {
    await deps.enqueue('promotion.changed', { promotionId: promotion.id });
    await deps.boundaries.schedule(promotion.id, 'activate', promotion.startsAt, now);
    await deps.boundaries.schedule(promotion.id, 'expire', promotion.endsAt, now);
  } catch (error) {
    deps.log.error(
      {
        promotionId: promotion.id,
        error: { message: error instanceof Error ? error.message : 'unknown' },
      },
      'promotion.changed could not be announced; the reconciler will repair',
    );
  }
}
