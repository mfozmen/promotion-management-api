/**
 * One per discount type. `discountCents` is what comes off the base price;
 * `valueError` rejects a value the type cannot mean, before any arithmetic.
 */
export interface DiscountCalculator {
  valueError(value: number): string | null;
  discountCents(baseCents: bigint, value: number): bigint;
}
