import type { Promotion } from './promotion.js';

/**
 * `Number.isSafeInteger` is load-bearing: `BigInt` throws on a fractional or
 * `NaN` input, and one bad row must not take down the batch around it.
 *
 * The other two restate the `promotions` check constraints and the zod
 * boundary. They come out once #50 is on `main` and the row cannot reach here
 * in that shape (REVIEW.md 2.4).
 */
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
