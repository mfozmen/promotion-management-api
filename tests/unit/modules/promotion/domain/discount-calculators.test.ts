import { describe, expect, it } from 'vitest';
import { discountCalculators } from '../../../../../src/modules/promotion/domain/discount-calculators.js';
import { fixedDiscount } from '../../../../../src/modules/promotion/domain/fixed-discount.js';
import { percentageDiscount } from '../../../../../src/modules/promotion/domain/percentage-discount.js';

describe('discountCalculators', () => {
  it('maps every discount type to its calculator', () => {
    expect(discountCalculators).toEqual({
      percentage: percentageDiscount,
      fixed: fixedDiscount,
    });
  });
});
