import type { Discount } from './dto/discount.js';

export const fixedDiscount: Discount = {
  valueError() {
    return null;
  },

  discountCents(_baseCents, value) {
    return BigInt(value);
  },
};
