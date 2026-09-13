import type { Discount } from './dto/discount.js';
import type { DiscountType } from './dto/discount-type.js';
import type { PricingOutcome } from './dto/pricing-outcome.js';
import type { Promotion } from './dto/promotion.js';
import { FixedDiscount } from './fixed-discount.js';
import { PercentageDiscount } from './percentage-discount.js';

export class EffectivePriceCalculator {
  private readonly discounts: Record<DiscountType, Discount>;

  // Keyed by the union itself, so widening it does not compile until its discount exists.
  constructor(
    discounts: Record<DiscountType, Discount> = {
      percentage: new PercentageDiscount(),
      fixed: new FixedDiscount(),
    },
  ) {
    this.discounts = discounts;
  }

  calculate(
    basePriceCents: number,
    promotion: Pick<Promotion, 'discountType' | 'value'>,
  ): PricingOutcome {
    // The database enum can widen before the union does, so an unknown type is a
    // defective row rather than a crash.
    const discount = Object.hasOwn(this.discounts, promotion.discountType)
      ? this.discounts[promotion.discountType]
      : undefined;

    if (discount === undefined) {
      return { ok: false, reason: 'unknown discount type' };
    }

    const reason = this.inputError(basePriceCents, promotion.value, discount);

    if (reason !== null) {
      return { ok: false, reason };
    }

    const base = BigInt(basePriceCents);
    const cents = discount.discountCents(base, promotion.value);

    // A discount larger than the price is a free product, not a defect.
    return { ok: true, effectivePriceCents: Number(cents > base ? 0n : base - cents) };
  }

  private inputError(basePriceCents: number, value: number, discount: Discount): string | null {
    if (!Number.isSafeInteger(basePriceCents) || basePriceCents < 0) {
      return 'base price is not a whole number of minor units in range';
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
      return 'discount value is not a whole, positive number';
    }

    return discount.valueError(value);
  }
}
