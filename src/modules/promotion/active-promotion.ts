import type { Promotion } from './promotion.js';

/** What `isActive` narrows to. */
export type ActivePromotion = Promotion & { status: 'active' };

/**
 * `now` is PostgreSQL's `now()`, read and injected by the caller: the database
 * clock decides activity, and nothing re-evaluates the window on the Node clock.
 */
export function isActive(promotion: Promotion, now: Date): promotion is ActivePromotion {
  const nowMs = now.getTime();

  return (
    promotion.status === 'active' &&
    promotion.startsAt.getTime() <= nowMs &&
    nowMs < promotion.endsAt.getTime()
  );
}
