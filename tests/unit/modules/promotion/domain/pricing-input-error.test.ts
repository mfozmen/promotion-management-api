import { describe, expect, it } from 'vitest';
import { fixedDiscount } from '@src/modules/promotion/domain/fixed-discount.js';
import { percentageDiscount } from '@src/modules/promotion/domain/percentage-discount.js';
import { pricingInputError } from '@src/modules/promotion/domain/pricing-input-error.js';

describe('pricingInputError', () => {
  it('accepts a whole base price and a whole, positive value', () => {
    expect(pricingInputError(10_000, 2500, percentageDiscount)).toBeNull();
  });

  it('rejects a base price that is not a whole, non-negative number of minor units', () => {
    for (const basePriceCents of [1000.5, NaN, Infinity, -Infinity, -500, 2 ** 53]) {
      expect(pricingInputError(basePriceCents, 2500, percentageDiscount)).toBe(
        'base price is not a whole number of minor units in range',
      );
    }
  });

  it('rejects a value that is not a whole, positive number, whatever the calculator', () => {
    for (const calculator of [percentageDiscount, fixedDiscount]) {
      for (const value of [2500.5, NaN, Infinity, -2500, 0, 2 ** 53]) {
        expect(pricingInputError(10_000, value, calculator)).toBe(
          'discount value is not a whole, positive number',
        );
      }
    }
  });

  it('defers the rest to the calculator it was given', () => {
    expect(pricingInputError(10_000, 10_001, percentageDiscount)).toBe(
      'discount is above 10000 basis points',
    );
    expect(pricingInputError(10_000, 10_001, fixedDiscount)).toBeNull();
  });
});
