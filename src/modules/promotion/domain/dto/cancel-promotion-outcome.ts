import type { PromotionView } from './promotion-view.js';

/** `changed` is false for a repeat call: the row was already cancelled, so
 *  nothing should be announced a second time. */
export type CancelPromotionOutcome =
  { ok: true; promotion: PromotionView; changed: boolean } | { ok: false; reason: 'not-found' };
