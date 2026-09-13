import type { DiscountCalculator } from './dto/discount-calculator.js';

export function pricingInputError(
  basePriceCents: number,
  value: number,
  calculator: DiscountCalculator,
): string | null {
  if (!Number.isSafeInteger(basePriceCents) || basePriceCents < 0) {
    return 'base price is not a whole number of minor units in range';
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    return 'discount value is not a whole, positive number';
  }

  return calculator.valueError(value);
}
