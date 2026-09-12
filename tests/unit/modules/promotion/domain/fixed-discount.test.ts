import { describe, expect, it } from 'vitest';
import { fixedDiscount } from '../../../../../src/modules/promotion/domain/fixed-discount.js';

describe('fixedDiscount', () => {
  it('takes the value off the base price, in minor units', () => {
    expect(fixedDiscount.discountCents(10_000n, 2500)).toBe(2500n);
  });

  it('does not depend on the base price', () => {
    expect(fixedDiscount.discountCents(500n, 800)).toBe(800n);
  });

  it('has no ceiling of its own: a value above the price is clamped by the caller', () => {
    expect(fixedDiscount.valueError(1_000_000)).toBeNull();
  });
});
