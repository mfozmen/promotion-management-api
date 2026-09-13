import { describe, expect, it } from 'vitest';
import { effectivePrice } from '@src/modules/promotion/domain/effective-price.js';
import type { Promotion } from '@src/modules/promotion/domain/dto/promotion.js';

type Discount = Pick<Promotion, 'discountType' | 'value'>;

function discount(overrides: Partial<Discount> = {}): Discount {
  return { discountType: 'percentage', value: 2500, ...overrides };
}

function priced(basePriceCents: number, overrides: Partial<Discount> = {}): number {
  const outcome = effectivePrice(basePriceCents, discount(overrides));

  if (!outcome.ok) throw new Error(`expected a price, got: ${outcome.reason}`);
  return outcome.effectivePriceCents;
}

describe('effectivePrice', () => {
  it('takes only the discount fields, so a resolver need not supply a window', () => {
    expect(effectivePrice(10_000, { discountType: 'percentage', value: 2500 })).toEqual({
      ok: true,
      effectivePriceCents: 7500,
    });
  });

  it('subtracts what the calculator for the type returns', () => {
    expect(priced(10_000, { value: 2500 })).toBe(7500);
    expect(priced(10_000, { discountType: 'fixed', value: 800 })).toBe(9200);
  });

  it('clamps to zero when the discount is larger than the price', () => {
    expect(priced(500, { discountType: 'fixed', value: 800 })).toBe(0);
    expect(priced(10_000, { value: 10_000 })).toBe(0);
    expect(priced(0, { value: 2500 })).toBe(0);
  });

  it('is exact at the largest price the money representation allows', () => {
    expect(priced(Number.MAX_SAFE_INTEGER, { value: 5000 })).toBe(4_503_599_627_370_496);
  });

  it('returns the reason from the guard rather than a price', () => {
    expect(effectivePrice(-500, discount())).toEqual({
      ok: false,
      reason: 'base price is not a whole number of minor units in range',
    });
    expect(effectivePrice(10_000, discount({ value: 10_001 }))).toEqual({
      ok: false,
      reason: 'discount is above 10000 basis points',
    });
  });

  it('reports an unknown discount type instead of throwing', () => {
    expect(
      effectivePrice(10_000, { discountType: 'tiered' as Discount['discountType'], value: 2500 }),
    ).toEqual({
      ok: false,
      reason: 'unknown discount type',
    });
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
});
