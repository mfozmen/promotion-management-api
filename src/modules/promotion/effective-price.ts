import type { ActivePromotion, Promotion } from './promotion.js';

/** A failure carries no price, so a caller cannot publish one by mistake. */
export type PricingOutcome =
  { ok: true; effectivePriceCents: number } | { ok: false; reason: string };

const BASIS_POINTS_PER_UNIT = 10_000n;

// Only the discount fields: the resolution query stops selecting the window
// columns once the windows leave the fact set, so a resolver has none to pass.
// Whether the candidate is active was decided by that query, on the database
// clock, before it got here.
export function applyPromotion(
  basePriceCents: number,
  promotion: Pick<Promotion, 'discountType' | 'value'>,
): PricingOutcome {
  // `BigInt` throws on a fractional or `NaN` input, and one bad row must not
  // take down the batch around it. The zod boundary and the `promotions` check
  // constraints will back these guards up; neither has landed on this branch.
  // A `reason` names the defect, never the stored value: the caller holds the
  // row and logs it, a message can end up in a response.
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
