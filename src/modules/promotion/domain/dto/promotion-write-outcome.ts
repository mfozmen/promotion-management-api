import type { PromotionView } from './promotion-view.js';

/**
 * Every way a promotion write can end. A failure carries no promotion, so a
 * caller cannot answer 200 with one, and the route maps each reason to a status
 * because a module under `src/modules/` has none to give (ADR-0008).
 *
 * An overlap carries no id. The envelope has no `details` to put one in, and
 * reading the conflicting row was work whose result was discarded before the
 * response was written.
 */
export type PromotionWriteOutcome =
  | { ok: true; promotion: PromotionView; now: Date }
  | { ok: false; reason: 'overlap' }
  | { ok: false; reason: 'not-assignable' }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'no-such-product' };
