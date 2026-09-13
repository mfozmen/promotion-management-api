import type { DiscountCalculator } from './dto/discount-calculator.js';

export const fixedDiscount: DiscountCalculator = {
  valueError() {
    return null;
  },

  discountCents(_baseCents, value) {
    return BigInt(value);
  },
};
