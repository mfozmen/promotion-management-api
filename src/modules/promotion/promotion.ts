export type DiscountType = 'percentage' | 'fixed';

export type PromotionStatus = 'draft' | 'active' | 'cancelled';

export interface Promotion {
  discountType: DiscountType;
  /** Basis points for `percentage`, minor units for `fixed`. */
  value: number;
  status: PromotionStatus;
  startsAt: Date;
  /** Exclusive: the window is `[startsAt, endsAt)`. */
  endsAt: Date;
}
