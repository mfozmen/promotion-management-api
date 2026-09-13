import { describe, expect, it } from 'vitest';
import { discountFor } from '@src/modules/promotion/domain/discount-for.js';
import { fixedDiscount } from '@src/modules/promotion/domain/fixed-discount.js';
import { percentageDiscount } from '@src/modules/promotion/domain/percentage-discount.js';

describe('discountFor', () => {
  it('returns the discount for each discount type', () => {
    expect(discountFor('percentage')).toBe(percentageDiscount);
    expect(discountFor('fixed')).toBe(fixedDiscount);
  });

  it('returns undefined for a type the database enum has but the union does not', () => {
    expect(discountFor('tiered')).toBeUndefined();
  });

  it('returns undefined for an inherited property rather than a function', () => {
    for (const key of ['toString', 'constructor', '__proto__']) {
      expect(discountFor(key)).toBeUndefined();
    }
  });
});
