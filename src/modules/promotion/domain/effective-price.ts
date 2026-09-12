import { pricingInputError } from './pricing-input-error.js';
import type { PricingOutcome } from './pricing-outcome.js';
import type { Promotion } from './promotion.js';

const BASIS_POINTS_PER_UNIT = 10_000n;

export function effectivePrice(
  basePriceCents: number,
  promotion: Pick<Promotion, 'discountType' | 'value'>,
): PricingOutcome {
  const reason = pricingInputError(basePriceCents, promotion);

  if (reason !== null) {
    return { ok: false, reason };
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
