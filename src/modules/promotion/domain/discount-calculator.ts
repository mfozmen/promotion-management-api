export interface DiscountCalculator {
  valueError(value: number): string | null;
  discountCents(baseCents: bigint, value: number): bigint;
}
