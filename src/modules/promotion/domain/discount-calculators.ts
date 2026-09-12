import type { DiscountCalculator } from './discount-calculator.js';
import type { DiscountType } from './discount-type.js';
import { fixedDiscount } from './fixed-discount.js';
import { percentageDiscount } from './percentage-discount.js';

export const discountCalculators: Record<DiscountType, DiscountCalculator> = {
  percentage: percentageDiscount,
  fixed: fixedDiscount,
};
