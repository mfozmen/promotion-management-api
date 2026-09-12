import { discountCalculators } from './discount-calculators.js';
import type { Promotion } from './promotion.js';

export function pricingInputError(
  basePriceCents: number,
  promotion: Pick<Promotion, 'discountType' | 'value'>,
): string | null {
  if (!Number.isSafeInteger(basePriceCents) || basePriceCents < 0) {
    return 'base price is not a whole number of minor units in range';
  }
  if (!Number.isSafeInteger(promotion.value) || promotion.value <= 0) {
    return 'discount value is not a whole, positive number';
  }

  return discountCalculators[promotion.discountType].valueError(promotion.value);
}
