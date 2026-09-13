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
    deps.publish('promotion.changed', { promotionId: promotion.id }),
    promotion.id,
    deps,
  );
  // A promotion that is already running needs no activation job: the publish above
  // is the activation. Scheduling one anyway gives it `delay: 0`, so two
  // `promotion.changed` jobs land within milliseconds and each keyset-scans the
  // same category — two full rescans of 50 000 products, on the queue that already
  // holds the system's longest job, with a cancel queued behind both.
  const alreadyRunning = promotion.startsAt.getTime() <= now.getTime();

  await Promise.all([
    settleAnnouncement(
      deps.scheduler.schedule(promotion.id, 'expire', promotion.endsAt, now),
      promotion.id,
      deps,
    ),
    ...(alreadyRunning
      ? []
      : [
          settleAnnouncement(
            deps.scheduler.schedule(promotion.id, 'activate', promotion.startsAt, now),
            promotion.id,
            deps,
          ),
        ]),
  ]);
}
