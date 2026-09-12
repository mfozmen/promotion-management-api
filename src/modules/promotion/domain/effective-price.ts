import { discountCalculators } from './discount-calculators.js';
import { pricingInputError } from './pricing-input-error.js';
import type { PricingOutcome } from './pricing-outcome.js';
import type { Promotion } from './promotion.js';

export function effectivePrice(
  basePriceCents: number,
  promotion: Pick<Promotion, 'discountType' | 'value'>,
): PricingOutcome {
  const reason = pricingInputError(basePriceCents, promotion);

  if (reason !== null) {
    return { ok: false, reason };
  }

  const base = BigInt(basePriceCents);
  const discount = discountCalculators[promotion.discountType].discountCents(base, promotion.value);

  // A discount larger than the price is a free product, not a defect.
  return { ok: true, effectivePriceCents: Number(discount > base ? 0n : base - discount) };
}
