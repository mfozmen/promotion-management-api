import { discountCalculatorFor } from './discount-calculator-for.js';
import { pricingInputError } from './pricing-input-error.js';
import type { PricingOutcome } from './pricing-outcome.js';
import type { Promotion } from './promotion.js';

export function effectivePrice(
  basePriceCents: number,
  promotion: Pick<Promotion, 'discountType' | 'value'>,
): PricingOutcome {
  // The database enum can widen before the union and its calculator do, so an
  // unknown type is a defective row rather than a crash.
  const calculator = discountCalculatorFor(promotion.discountType);

  if (calculator === undefined) {
    return { ok: false, reason: 'unknown discount type' };
  }

  const reason = pricingInputError(basePriceCents, promotion.value, calculator);

  if (reason !== null) {
    return { ok: false, reason };
  }

  const base = BigInt(basePriceCents);
  const discount = calculator.discountCents(base, promotion.value);

  // A discount larger than the price is a free product, not a defect.
  return { ok: true, effectivePriceCents: Number(discount > base ? 0n : base - discount) };
}
