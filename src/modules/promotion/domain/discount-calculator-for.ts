import { discountCalculators } from './discount-calculators.js';
import type { DiscountCalculator } from './discount-calculator.js';

export function discountCalculatorFor(discountType: string): DiscountCalculator | undefined {
  return Object.hasOwn(discountCalculators, discountType)
    ? discountCalculators[discountType as keyof typeof discountCalculators]
    : undefined;
}
