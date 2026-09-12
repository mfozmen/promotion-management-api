import type { DiscountType } from './discount-type.js';
import type { PromotionStatus } from './promotion-status.js';

export interface Promotion {
  discountType: DiscountType;
  /** Basis points for `percentage`, minor units for `fixed`. */
  value: number;
  status: PromotionStatus;
  startsAt: Date;
  /** Exclusive: the window is `[startsAt, endsAt)`. */
  endsAt: Date;
}
