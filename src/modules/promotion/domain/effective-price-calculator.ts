import type { Discount } from './dto/discount.js';
import type { DiscountType } from './dto/discount-type.js';
import type { PricingOutcome } from './dto/pricing-outcome.js';
import type { Promotion } from './dto/promotion.js';
import { FixedDiscount } from './fixed-discount.js';
import { PercentageDiscount } from './percentage-discount.js';

// Keyed by the union itself, so widening it does not compile until its discount exists.
// Built once rather than per construction, and frozen because every calculator shares it;
// the discounts themselves hold no state to protect.
const DEFAULT_DISCOUNTS: Readonly<Record<DiscountType, Discount>> = Object.freeze({
  percentage: new PercentageDiscount(),
  fixed: new FixedDiscount(),
});

export class EffectivePriceCalculator {
  constructor(
    private readonly discounts: Readonly<Record<DiscountType, Discount>> = DEFAULT_DISCOUNTS,
  ) {}

  calculate(
    basePriceCents: number,
    promotion: Pick<Promotion, 'discountType' | 'value'>,
  ): PricingOutcome {
    const discount = Object.hasOwn(this.discounts, promotion.discountType)
      ? this.discounts[promotion.discountType]
      : undefined;

    if (discount === undefined) {
      return { ok: false, reason: 'unknown discount type' };
    }

    const reason = this.validateBasePriceAndDiscount(basePriceCents, promotion.value, discount);

    if (reason !== null) {
      return { ok: false, reason };
    }

    const base = BigInt(basePriceCents);
    const cents = discount.discountCents(base, promotion.value);

    // A discount larger than the price is a free product, not a defect.
    return { ok: true, effectivePriceCents: Number(cents > base ? 0n : base - cents) };
  }

  private validateBasePriceAndDiscount(
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
}
