import { describe, expect, it } from 'vitest';
import type { ActivePromotion } from '../../../../src/modules/promotion/active-promotion.js';
import { effectivePrice } from '../../../../src/modules/promotion/effective-price.js';
import type { Promotion } from '../../../../src/modules/promotion/promotion.js';

function active(overrides: Partial<Omit<Promotion, 'status'>> = {}): ActivePromotion {
  return {
    discountType: 'percentage',
    value: 2500,
    startsAt: new Date('2026-09-12T00:00:00.000Z'),
    endsAt: new Date('2026-09-13T00:00:00.000Z'),
    ...overrides,
    status: 'active',
  };
}

function priced(
  basePriceCents: number,
  overrides: Partial<Omit<Promotion, 'status'>> = {},
): number {
  const outcome = effectivePrice(basePriceCents, active(overrides));

  if (!outcome.ok) throw new Error(`expected a price, got: ${outcome.reason}`);
  return outcome.effectivePriceCents;
}

describe('effectivePrice', () => {
  it('takes only the discount fields, so a resolver need not supply a window', () => {
    // The resolution query stops selecting starts_at/ends_at once the windows
    // leave the fact set, so the parameter must not demand them.
    expect(effectivePrice(10_000, { discountType: 'percentage', value: 2500 })).toEqual({
      ok: true,
      effectivePriceCents: 7500,
    });
  });

  it('applies a percentage discount in basis points', () => {
    expect(priced(10_000, { value: 2500 })).toBe(7500);
  });

  it('applies a fixed discount in minor units', () => {
    expect(priced(10_000, { discountType: 'fixed', value: 2500 })).toBe(7500);
  });

  it('floors the discount, so the customer pays at most one minor unit more', () => {
    expect(priced(999, { value: 2500 })).toBe(750);
    expect(priced(1000, { value: 3333 })).toBe(667);
  });

  it('returns zero for a 100 % discount', () => {
    expect(priced(10_000, { value: 10_000 })).toBe(0);
  });

  it('returns zero for a fixed discount larger than the base price', () => {
    expect(priced(500, { discountType: 'fixed', value: 800 })).toBe(0);
  });

  it('returns zero for a zero base price', () => {
    expect(priced(0, { value: 2500 })).toBe(0);
    expect(priced(0, { discountType: 'fixed', value: 800 })).toBe(0);
  });

  it('is exact at the largest price the money representation allows', () => {
    expect(priced(Number.MAX_SAFE_INTEGER, { value: 5000 })).toBe(4_503_599_627_370_496);
  });

  it('is exact at a large price where double arithmetic would round', () => {
    expect(priced(4_171_863_899_102, { value: 7049 })).toBe(1_231_117_036_626);
  });

  it('never returns a price outside [0, base]', () => {
    for (const value of [1, 2500, 10_000]) {
      for (const discountType of ['percentage', 'fixed'] as const) {
        const effective = priced(10_000, { discountType, value });

        expect(effective).toBeLessThanOrEqual(10_000);
        expect(effective).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('rejects a base price that is not a whole, non-negative number of minor units', () => {
    for (const basePriceCents of [1000.5, NaN, Infinity, -Infinity, -500, 2 ** 53]) {
      expect(effectivePrice(basePriceCents, active())).toEqual({
        ok: false,
        reason: 'base price is not a whole number of minor units in range',
      });
    }
  });

  it('rejects a discount value that is not a whole, positive number', () => {
    for (const discountType of ['percentage', 'fixed'] as const) {
      for (const value of [2500.5, NaN, Infinity, -2500, 0, 2 ** 53]) {
        expect(effectivePrice(10_000, active({ discountType, value }))).toEqual({
          ok: false,
          reason: 'discount value is not a whole, positive number',
        });
      }
    }
  });

  it('rejects a percentage above 100 % rather than clamping it to a free product', () => {
    expect(effectivePrice(10_000, active({ value: 10_001 }))).toEqual({
      ok: false,
      reason: 'percentage discount is above 10000 basis points',
    });
  });
});
