/**
 * Pure pricing core: the one implementation of the discount formula
 * (REVIEW.md 1.3). The event handler, the reconciler and the tests all price
 * through these functions.
 *
 * Money is integer minor units and percentages are basis points
 * (`10000 = 100 %`), so every operation here is integer arithmetic
 * (REVIEW.md 1.1). `now` is a parameter, never `new Date()`, so there is one
 * clock and tests can inject it (REVIEW.md 1.7, 7.5).
 */

export type DiscountType = 'percentage' | 'fixed';

export type PromotionStatus = 'draft' | 'active' | 'cancelled';

/**
 * The part of a `promotions` row the pricing core reads (domain design
 * section 3). `id` and `name` are deliberately absent: the caller keeps the
 * row it resolved and puts them in the response, and the resolution query
 * should not widen for fields no rule here uses.
 */
export interface Promotion {
  discountType: DiscountType;
  /** Basis points for `percentage`, minor units for `fixed`. Always > 0. */
  value: number;
  status: PromotionStatus;
  /** Inclusive start of the validity window. */
  startsAt: Date;
  /** Exclusive end of the validity window. */
  endsAt: Date;
}

const BASIS_POINTS_PER_UNIT = 10_000;

/**
 * Effective price in minor units for `basePriceCents` under `promotion`, or
 * the base price when no promotion applies. `promotion` is what
 * `resolveApplied` returned: this function prices whatever it is given and
 * does not re-check the validity window.
 *
 * The discount is floored, so the customer pays at most one minor unit more
 * than the ideal price (REVIEW.md 1.4). The result is never negative and never
 * above the base price (REVIEW.md 1.5): a fixed discount larger than the base
 * clamps to zero, while a percentage above 10 000 basis points is rejected at
 * the API boundary and by the `promotions` check constraint rather than
 * clamped here.
 *
 * The percentage step multiplies before it divides, and `basePriceCents *
 * value` leaves the exact-integer range of a double at a base of roughly
 * 9e11 minor units, which the `bigint` price columns allow. The multiplication
 * is therefore done in `bigint`, where truncating division is the floor for
 * non-negative operands; the quotient is at most the base price, so it always
 * converts back exactly.
 */
export function applyPromotion(basePriceCents: number, promotion: Promotion | null): number {
  if (promotion === null) return basePriceCents;

  const discountCents =
    promotion.discountType === 'percentage'
      ? Number((BigInt(basePriceCents) * BigInt(promotion.value)) / BigInt(BASIS_POINTS_PER_UNIT))
      : promotion.value;

  return Math.min(Math.max(basePriceCents - discountCents, 0), basePriceCents);
}

/**
 * Whether `promotion` applies at `now`: it is assigned and not cancelled, and
 * `now` falls inside the half-open window `[startsAt, endsAt)` (REVIEW.md 1.6).
 * Drafts and cancelled promotions are never active.
 */
export function isActive(promotion: Promotion, now: Date): boolean {
  const nowMs = now.getTime();

  return (
    promotion.status === 'active' &&
    promotion.startsAt.getTime() <= nowMs &&
    nowMs < promotion.endsAt.getTime()
  );
}

/**
 * The applied promotion for a product at `now`: its active product-level
 * promotion if there is one, else the active category-level promotion for its
 * category, else none (ADR-0004). Product level wins even when the category
 * discount is larger.
 */
export function resolveApplied(
  productPromotion: Promotion | null,
  categoryPromotion: Promotion | null,
  now: Date,
): Promotion | null {
  if (productPromotion !== null && isActive(productPromotion, now)) return productPromotion;
  if (categoryPromotion !== null && isActive(categoryPromotion, now)) return categoryPromotion;
  return null;
}
