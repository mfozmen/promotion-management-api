import type { PromotionView } from '../domain/promotion-view.js';

/**
 * Cancelling reports whether it changed anything, because a repeat is a success
 * that must not be announced again: each `promotion.changed` for a category
 * promotion fans out to every product in that category, so a client retry loop
 * would recompute 50 000 rows per call.
 *
 * There is no `now` here, unlike a create or an assign: cancelling schedules
 * nothing, so it has no instant to schedule against.
 */
export type CancelPromotionOutcome =
  | { ok: true; promotion: PromotionView; changed: boolean }
  | { ok: false; reason: 'not-found' };
