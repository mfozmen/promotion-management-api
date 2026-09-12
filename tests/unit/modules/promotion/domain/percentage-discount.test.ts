import { describe, expect, it } from 'vitest';
import { percentageDiscount } from '@src/modules/promotion/domain/percentage-discount.js';

describe('percentageDiscount', () => {
  it('takes basis points off the base price', () => {
    expect(percentageDiscount.discountCents(10_000n, 2500)).toBe(2500n);
  });

  it('floors the discount, so rounding goes against the customer', () => {
    expect(percentageDiscount.discountCents(999n, 2500)).toBe(249n);
    expect(percentageDiscount.discountCents(1000n, 3333)).toBe(333n);
  });

  it('is exact where double arithmetic would round', () => {
    expect(percentageDiscount.discountCents(4_171_863_899_102n, 7049)).toBe(2_940_746_862_476n);
  });

  it('rejects a value above a full discount rather than clamping it', () => {
    expect(percentageDiscount.valueError(10_001)).toBe('discount is above 10000 basis points');
  });

  it('accepts a full discount and anything below it', () => {
    expect(percentageDiscount.valueError(10_000)).toBeNull();
    expect(percentageDiscount.valueError(1)).toBeNull();
  });
});
