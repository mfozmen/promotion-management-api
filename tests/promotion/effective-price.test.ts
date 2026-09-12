import { describe, expect, it } from 'vitest';
import { applyPromotion, isActive } from '../../src/modules/promotion/effective-price.js';
import type { Promotion } from '../../src/modules/promotion/promotion.js';

const NOW = new Date('2026-09-12T12:00:00.000Z');
const MS = 1;

function promotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    discountType: 'percentage',
    value: 2500,
    status: 'active',
    startsAt: new Date('2026-09-12T00:00:00.000Z'),
    endsAt: new Date('2026-09-13T00:00:00.000Z'),
    ...overrides,
  };
}

function priced(basePriceCents: number, overrides: Partial<Promotion> = {}): number {
  const outcome = applyPromotion(basePriceCents, promotion(overrides));

  if (!outcome.ok) throw new Error(`expected a price, got: ${outcome.reason}`);
  return outcome.effectivePriceCents;
}

describe('applyPromotion', () => {
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
      expect(applyPromotion(basePriceCents, promotion())).toEqual({
        ok: false,
        reason: `base price ${basePriceCents} is not a whole number of minor units in range`,
      });
    }
  });

  it('rejects a discount value that is not a whole, positive number', () => {
    for (const discountType of ['percentage', 'fixed'] as const) {
      for (const value of [2500.5, NaN, Infinity, -2500, 0, 2 ** 53]) {
        expect(applyPromotion(10_000, promotion({ discountType, value }))).toEqual({
          ok: false,
          reason: `discount value ${value} is not a whole, positive number`,
        });
      }
    }
  });

  it('rejects a percentage above 100 % rather than clamping it to a free product', () => {
    expect(applyPromotion(10_000, promotion({ value: 10_001 }))).toEqual({
      ok: false,
      reason: 'percentage discount 10001 is above 10000 basis points',
    });
  });
});

describe('isActive', () => {
  it('is active exactly at startsAt', () => {
    expect(isActive(promotion({ startsAt: NOW }), NOW)).toBe(true);
  });

  it('is inactive one millisecond before startsAt', () => {
    expect(isActive(promotion({ startsAt: new Date(NOW.getTime() + MS) }), NOW)).toBe(false);
  });

  it('is active one millisecond before endsAt', () => {
    expect(isActive(promotion({ endsAt: new Date(NOW.getTime() + MS) }), NOW)).toBe(true);
  });

  it('is inactive exactly at endsAt, the window being half-open', () => {
    expect(isActive(promotion({ endsAt: NOW }), NOW)).toBe(false);
  });

  it('is inactive one millisecond after endsAt', () => {
    expect(isActive(promotion({ endsAt: new Date(NOW.getTime() - MS) }), NOW)).toBe(false);
  });

  it('is never active for a window that ends before it starts', () => {
    const inverted = promotion({
      startsAt: new Date(NOW.getTime() + MS),
      endsAt: new Date(NOW.getTime() - MS),
    });

    expect(isActive(inverted, NOW)).toBe(false);
    expect(isActive(inverted, new Date(NOW.getTime() - MS))).toBe(false);
    expect(isActive(inverted, new Date(NOW.getTime() + MS))).toBe(false);
  });

  it('is never active for a draft', () => {
    expect(isActive(promotion({ status: 'draft' }), NOW)).toBe(false);
  });

  it('is never active for a cancelled promotion', () => {
    expect(isActive(promotion({ status: 'cancelled' }), NOW)).toBe(false);
  });
});
