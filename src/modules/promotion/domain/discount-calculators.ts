import type { DiscountCalculator } from './discount-calculator.js';
import type { DiscountType } from './discount-type.js';
import { fixedDiscount } from './fixed-discount.js';
import { percentageDiscount } from './percentage-discount.js';

/**
 * `Record<DiscountType, …>` is the point: a new member of the union does not
 * compile until its calculator exists here, so a discount type cannot ship
 * without its arithmetic.
 */
export const discountCalculators: Record<DiscountType, DiscountCalculator> = {
  percentage: percentageDiscount,
  fixed: fixedDiscount,
};
