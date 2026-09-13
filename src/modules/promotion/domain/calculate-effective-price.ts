import { discountFor } from './discount-for.js';
import type { Discount } from './dto/discount.js';
import type { PricingOutcome } from './dto/pricing-outcome.js';
import type { Promotion } from './dto/promotion.js';

function validateBasePriceAndDiscount(
  basePriceCents: number,
  value: number,
  discount: Discount,
): string | null {
  if (!Number.isSafeInteger(basePriceCents) || basePriceCents < 0) {
    return 'base price is not a whole number of minor units in range';
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    return 'discount value is not a whole, positive number';
  }

  return discount.valueError(value);
}

export function calculateEffectivePrice(
  basePriceCents: number,
  promotion: Pick<Promotion, 'discountType' | 'value'>,
): PricingOutcome {
  // The database enum can widen before the union does, so an unknown type is a
  // defective row rather than a crash.
  const discount = discountFor(promotion.discountType);

  if (discount === undefined) {
    return { ok: false, reason: 'unknown discount type' };
  }

  const reason = validateBasePriceAndDiscount(basePriceCents, promotion.value, discount);

  if (reason !== null) {
    return { ok: false, reason };
  }

  const base = BigInt(basePriceCents);
  const cents = discount.discountCents(base, promotion.value);

  // A discount larger than the price is a free product, not a defect.
  return { ok: true, effectivePriceCents: Number(cents > base ? 0n : base - cents) };
}
