import { describe, expect, it } from 'vitest';
import { discountCalculatorFor } from '@src/modules/promotion/domain/discount-calculator-for.js';
import { fixedDiscount } from '@src/modules/promotion/domain/fixed-discount.js';
import { percentageDiscount } from '@src/modules/promotion/domain/percentage-discount.js';

describe('discountCalculatorFor', () => {
  it('returns the calculator for each discount type', () => {
    expect(discountCalculatorFor('percentage')).toBe(percentageDiscount);
    expect(discountCalculatorFor('fixed')).toBe(fixedDiscount);
  });

  it('returns undefined for a type the database enum has but the union does not', () => {
    expect(discountCalculatorFor('tiered')).toBeUndefined();
  });

  it('returns undefined for an inherited property rather than a function', () => {
    for (const key of ['toString', 'constructor', '__proto__']) {
      expect(discountCalculatorFor(key)).toBeUndefined();
    }
  });
});
