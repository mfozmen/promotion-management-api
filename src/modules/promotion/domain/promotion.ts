import type { DiscountType } from './discount-type.js';
import type { PromotionStatus } from './promotion-status.js';

export interface Promotion {
  discountType: DiscountType;
  value: number;
  status: PromotionStatus;
  startsAt: Date;
  endsAt: Date;
}
