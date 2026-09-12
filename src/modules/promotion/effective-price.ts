import type { ActivePromotion } from './active-promotion.js';
import type { Promotion } from './promotion.js';

/** A failure carries no price, so a caller cannot publish one by mistake. */
export type PricingOutcome =
  { ok: true; effectivePriceCents: number } | { ok: false; reason: string };

const BASIS_POINTS_PER_UNIT = 10_000n;

export function applyPromotion(
  basePriceCents: number,
  promotion: Pick<Promotion, 'discountType' | 'value'>,
): PricingOutcome {
  // One bad row must not take down the batch around it, so this returns rather
  // than throwing; a `reason` names the defect and never the stored value.
  if (!Number.isSafeInteger(basePriceCents) || basePriceCents < 0) {
    return { ok: false, reason: 'base price is not a whole number of minor units in range' };
  }
  if (!Number.isSafeInteger(promotion.value) || promotion.value <= 0) {
    return { ok: false, reason: 'discount value is not a whole, positive number' };
  }
  if (promotion.discountType === 'percentage' && promotion.value > 10_000) {
    return { ok: false, reason: 'percentage discount is above 10000 basis points' };
  }

  const base = BigInt(basePriceCents);
  const discount =
    promotion.discountType === 'percentage'
      ? // Floored on the discount, so rounding goes against the customer by at
        // most one minor unit rather than in their favour.
        (base * BigInt(promotion.value)) / BASIS_POINTS_PER_UNIT
      : BigInt(promotion.value);

  // A discount larger than the price is a free product, not a defect.
  return { ok: true, effectivePriceCents: Number(discount > base ? 0n : base - discount) };
}

/**
 * `now` is PostgreSQL's `now()`, read and injected by the caller: the database
 * clock decides activity, and nothing re-evaluates the window on the Node clock.
 */
export function isActive(promotion: Promotion, now: Date): promotion is ActivePromotion {
  const nowMs = now.getTime();

  return (
    promotion.status === 'active' &&
    promotion.startsAt.getTime() <= nowMs &&
    nowMs < promotion.endsAt.getTime()
  );
}
