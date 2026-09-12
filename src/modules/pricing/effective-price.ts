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

const BASIS_POINTS_PER_UNIT = 10_000;

/**
 * Prices whatever it is given — normally `resolveApplied`'s result — without
 * re-checking the validity window. The discount is floored, so rounding goes
 * against the customer by at most one minor unit.
 */
export function applyPromotion(basePriceCents: number, promotion: Promotion | null): number {
  if (promotion === null) return basePriceCents;

  const discountCents =
    promotion.discountType === 'percentage'
      ? // In doubles `base * value` leaves the exact-integer range around 9e11
        // minor units, which the price columns allow, and floors a cent wrong.
        // Truncating bigint division is that floor for non-negative operands,
        // and the quotient is at most the base, so `Number` is always exact.
        Number((BigInt(basePriceCents) * BigInt(promotion.value)) / BigInt(BASIS_POINTS_PER_UNIT))
      : promotion.value;

  // An out-of-range `value` is rejected by the API boundary and the check
  // constraint; this clamp is the last line before a price reaches a customer.
  return Math.min(Math.max(basePriceCents - discountCents, 0), basePriceCents);
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
