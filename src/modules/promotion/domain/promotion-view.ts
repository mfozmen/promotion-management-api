import type { DiscountType } from './discount-type.js';
import type { PromotionState } from './promotion-state.js';
import type { PromotionStatus } from './promotion-status.js';

/** A promotion as the admin API returns it. */
export interface PromotionView {
  id: number;
  name: string;
  discountType: DiscountType;
  value: number;
  startsAt: Date;
  endsAt: Date;
  productId: number | null;
  category: string | null;
  status: PromotionStatus;
  state: PromotionState;
}
