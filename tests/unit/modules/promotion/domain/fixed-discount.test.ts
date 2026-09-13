import { describe, expect, it } from 'vitest';
import { FixedDiscount } from '@src/modules/promotion/domain/fixed-discount.js';

describe('FixedDiscount', () => {
  const discount = new FixedDiscount();

  it('takes the value off the base price, in minor units', () => {
    expect(discount.discountCents(10_000n, 2500)).toBe(2500n);
  });

  it('does not depend on the base price', () => {
    expect(discount.discountCents(500n, 800)).toBe(800n);
  });

  it('has no ceiling of its own: a value above the price is clamped by the caller', () => {
    expect(discount.valueError()).toBeNull();
  });
});
