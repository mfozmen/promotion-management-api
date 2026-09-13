export interface Discount {
  /** Call before `discountCents`: it rejects a value the type cannot mean. */
  valueError(value: number): string | null;
  discountCents(baseCents: bigint, value: number): bigint;
}
