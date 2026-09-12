import { describe, expect, it } from 'vitest';
import { pricingInputError } from '../../../../../src/modules/promotion/domain/pricing-input-error.js';
import type { Promotion } from '../../../../../src/modules/promotion/domain/promotion.js';

type Discount = Pick<Promotion, 'discountType' | 'value'>;

function discount(overrides: Partial<Discount> = {}): Discount {
  return { discountType: 'percentage', value: 2500, ...overrides };
}

describe('pricingInputError', () => {
  it('accepts a whole base price and a whole, positive value', () => {
    expect(pricingInputError(10_000, discount())).toBeNull();
  });

  it('rejects a base price that is not a whole, non-negative number of minor units', () => {
    for (const basePriceCents of [1000.5, NaN, Infinity, -Infinity, -500, 2 ** 53]) {
      expect(pricingInputError(basePriceCents, discount())).toBe(
        'base price is not a whole number of minor units in range',
      );
    }
  });

  it('rejects a value that is not a whole, positive number, whatever the type', () => {
    for (const discountType of ['percentage', 'fixed'] as const) {
      for (const value of [2500.5, NaN, Infinity, -2500, 0, 2 ** 53]) {
        expect(pricingInputError(10_000, discount({ discountType, value }))).toBe(
          'discount value is not a whole, positive number',
        );
      }
    }
  });

  it('defers the rest to the calculator for the type', () => {
    expect(pricingInputError(10_000, discount({ value: 10_001 }))).toBe(
      'discount is above 10000 basis points',
    );
    expect(
      pricingInputError(10_000, discount({ discountType: 'fixed', value: 10_001 })),
    ).toBeNull();
  });
});
