import type { PromotionView } from './promotion-view.js';

/** Every way a promotion write can end. */
export type PromotionWriteOutcome =
  | { ok: true; promotion: PromotionView; now: Date }
  | { ok: false; reason: 'overlap' }
  | { ok: false; reason: 'not-assignable' }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'no-such-product' };
