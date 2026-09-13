import type { Discount } from './dto/discount.js';

const BASIS_POINTS_PER_UNIT = 10_000n;
const FULL_DISCOUNT_BASIS_POINTS = 10_000;

export class PercentageDiscount implements Discount {
  valueError(value: number): string | null {
    return value > FULL_DISCOUNT_BASIS_POINTS
      ? `discount is above ${FULL_DISCOUNT_BASIS_POINTS} basis points`
      : null;
  }

  // Floored on the discount, so rounding goes against the customer by at most
  // one minor unit rather than in their favour.
  discountCents(baseCents: bigint, value: number): bigint {
    return (baseCents * BigInt(value)) / BASIS_POINTS_PER_UNIT;
  }
}
