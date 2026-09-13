import type { PromotionView } from '../domain/promotion-view.js';

/**
 * Every way a promotion write can end. A failure carries no promotion, so a
 * caller cannot answer 200 with one, and the route maps each reason to a status
 * because a module under `src/modules/` has none to give (ADR-0008).
 *
 * `conflictingPromotionId` is nullable: the row that caused the exclusion
 * violation can be cancelled by another request between the failure and the
 * lookup, and reporting no id beats inventing one.
 */
export type PromotionWriteOutcome =
  | { ok: true; promotion: PromotionView }
  | { ok: false; reason: 'overlap'; conflictingPromotionId: number | null }
  | { ok: false; reason: 'not-assignable' }
  | { ok: false; reason: 'not-found' };
