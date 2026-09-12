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
  if (promotion.discountType === 'percentage' && promotion.value > 10_000) {
    return 'percentage discount is above 10000 basis points';
  }

  return null;
}
