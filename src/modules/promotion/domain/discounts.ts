import type { DiscountType } from './dto/discount-type.js';
import type { Discount } from './dto/discount.js';
import { fixedDiscount } from './fixed-discount.js';
import { percentageDiscount } from './percentage-discount.js';

export const discounts: Record<DiscountType, Discount> = {
  percentage: percentageDiscount,
  fixed: fixedDiscount,
};
