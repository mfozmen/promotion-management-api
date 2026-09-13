import type { Discount } from './dto/discount.js';

export class FixedDiscount implements Discount {
  valueError(): string | null {
    return null;
  }

  discountCents(_baseCents: bigint, value: number): bigint {
    return BigInt(value);
  }
}
