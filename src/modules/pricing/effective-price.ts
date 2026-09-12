export type DiscountType = 'percentage' | 'fixed';

export type PromotionStatus = 'draft' | 'active' | 'cancelled';

// `id` and `name` are absent on purpose: no rule here reads them, and the
// resolution query should not widen for them. The caller keeps the row.
export interface Promotion {
  discountType: DiscountType;
  /** Basis points for `percentage`, minor units for `fixed`. Always > 0. */
  value: number;
  status: PromotionStatus;
  startsAt: Date;
  /** Exclusive: the window is `[startsAt, endsAt)`. */
  endsAt: Date;
}

const BASIS_POINTS_PER_UNIT = 10_000n;

function assertWholeMinorUnits(amount: number, name: string): void {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`${name} must be a whole number of minor units, received ${amount}`);
  }
}

/**
 * Prices whatever it is given — normally `resolveApplied`'s result — without
 * re-checking the validity window. The discount is floored, so rounding goes
 * against the customer by at most one minor unit.
 *
 * Throws on an amount that is not a whole minor unit: both are `number`, so
 * nothing in the types stops `1000.5`, `NaN` or a value past 2^53, and
 * unguarded the fixed branch would return a fractional cent or `NaN` as a
 * price that nothing downstream would notice. Callers read whole minor units
 * out of `bigint` columns, so a violation is a bug at the caller rather than a
 * bad row, and is raised rather than returned; the untrusted vendor row is
 * `priceRow`'s job, and that one returns a rejection.
 */
export function applyPromotion(basePriceCents: number, promotion: Promotion | null): number {
  if (promotion === null) return basePriceCents;

  assertWholeMinorUnits(basePriceCents, 'basePriceCents');
  assertWholeMinorUnits(promotion.value, 'promotion value');

  const base = BigInt(basePriceCents);
  // In doubles `base * value` leaves the exact-integer range around 9e11 minor
  // units, which the price columns allow, and floors a cent wrong. Truncating
  // bigint division is that floor for non-negative operands.
  const discount =
    promotion.discountType === 'percentage'
      ? (base * BigInt(promotion.value)) / BASIS_POINTS_PER_UNIT
      : BigInt(promotion.value);

  // Out-of-range values are rejected by the API boundary and the check
  // constraints; this clamp is the last line before a price reaches a
  // customer, and it is what keeps the result inside `[0, basePriceCents]` —
  // and therefore exactly representable — for a discount of any size.
  if (discount <= 0n) return basePriceCents;
  return discount >= base ? 0 : Number(base - discount);
}

export function isActive(promotion: Promotion, now: Date): boolean {
  const nowMs = now.getTime();

  return (
    promotion.status === 'active' &&
    promotion.startsAt.getTime() <= nowMs &&
    nowMs < promotion.endsAt.getTime()
  );
}

/** Product level wins even when the category discount is larger (ADR-0004). */
export function resolveApplied(
  productPromotion: Promotion | null,
  categoryPromotion: Promotion | null,
  now: Date,
): Promotion | null {
  if (productPromotion !== null && isActive(productPromotion, now)) return productPromotion;
  if (categoryPromotion !== null && isActive(categoryPromotion, now)) return categoryPromotion;
  return null;
}
