import type { DiscountType } from '../../../promotion/domain/dto/discount-type.js';

/** A promotion that could apply to a product, already filtered to active by the
 *  database clock — the window and the status are not here because no rule and
 *  no calculator may form a second opinion about them (REVIEW.md 2.7). */
export interface PromotionCandidate {
  id: number;
  name: string;
  discountType: DiscountType;
  value: number;
}
