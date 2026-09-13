import type { PromotionView } from '../domain/dto/promotion-view.js';
import type { Announcement } from './announcement.js';
import { settleAnnouncement } from './settle-announcement.js';

/**
 * One event covers create, assign, cancel and both boundaries: the read-model
 * handler recomputes the affected products and never asks why the promotion
 * changed, so five names would be five handlers with one body (spec section 6).
 *
 * The event goes first and the two boundaries are scheduled independently, so
 * losing one does not cost the other. Losing `expire` gives a discount away past
 * its window; losing `activate` only delays one.
 */
export async function announcePromotion(
  promotion: PromotionView,
  now: Date,
  deps: Announcement,
): Promise<void> {
  await settleAnnouncement(
    deps.enqueue('promotion.changed', { promotionId: promotion.id }),
    promotion.id,
    deps,
  );
  await Promise.all([
    settleAnnouncement(
      deps.boundaries.schedule(promotion.id, 'expire', promotion.endsAt, now),
      promotion.id,
      deps,
    ),
    settleAnnouncement(
      deps.boundaries.schedule(promotion.id, 'activate', promotion.startsAt, now),
      promotion.id,
      deps,
    ),
  ]);
}
