import { describe, expect, it } from 'vitest';
import { EffectivePriceCalculator } from '@src/modules/promotion/domain/effective-price-calculator.js';
import type { Promotion } from '@src/modules/promotion/domain/dto/promotion.js';

type PromotionDiscount = Pick<Promotion, 'discountType' | 'value'>;

function discount(overrides: Partial<PromotionDiscount> = {}): PromotionDiscount {
  return { discountType: 'percentage', value: 2500, ...overrides };
}

function priced(basePriceCents: number, overrides: Partial<PromotionDiscount> = {}): number {
  const outcome = new EffectivePriceCalculator().calculate(basePriceCents, discount(overrides));

  if (!outcome.ok) throw new Error(`expected a price, got: ${outcome.reason}`);
  return outcome.effectivePriceCents;
}

describe('EffectivePriceCalculator', () => {
  const calculator = new EffectivePriceCalculator();

  it('takes only the discount fields, so a resolver need not supply a window', () => {
    expect(calculator.calculate(10_000, { discountType: 'percentage', value: 2500 })).toEqual({
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

  it('rejects a base price that is not a whole, non-negative number of minor units', () => {
    for (const basePriceCents of [1000.5, NaN, Infinity, -Infinity, -500, 2 ** 53]) {
      expect(calculator.calculate(basePriceCents, discount())).toEqual({
        ok: false,
        reason: 'base price is not a whole number of minor units in range',
      });
    }
  });

  it('rejects a value that is not whole and positive, whatever the discount', () => {
    for (const discountType of ['percentage', 'fixed'] as const) {
      for (const value of [2500.5, NaN, Infinity, -2500, 0, 2 ** 53]) {
        expect(calculator.calculate(10_000, discount({ discountType, value }))).toEqual({
          ok: false,
          reason: 'discount value is not a whole, positive number',
        });
      }
    }
  });

  it('defers the rest to the discount, which is why fixed accepts what percentage rejects', () => {
    expect(calculator.calculate(10_000, discount({ value: 10_001 }))).toEqual({
      ok: false,
      reason: 'discount is above 10000 basis points',
    });
    expect(
      calculator.calculate(10_000, discount({ discountType: 'fixed', value: 10_001 })),
    ).toEqual({ ok: true, effectivePriceCents: 0 });
  });

  it('returns the reason from the guard rather than a price', () => {
    expect(calculator.calculate(-500, discount())).toEqual({
      ok: false,
      reason: 'base price is not a whole number of minor units in range',
    });
    expect(calculator.calculate(10_000, discount({ value: 10_001 }))).toEqual({
      ok: false,
      reason: 'discount is above 10000 basis points',
    });
  });

  it('takes its discounts from the constructor, so a caller can stand one in', () => {
    const stub = { valueError: () => null, discountCents: () => 1n };
    const withStub = new EffectivePriceCalculator({ percentage: stub, fixed: stub });

    expect(withStub.calculate(10_000, discount())).toEqual({ ok: true, effectivePriceCents: 9999 });
  });

  it('reports an inherited property as an unknown type rather than calling it', () => {
    for (const discountType of ['toString', 'constructor', '__proto__']) {
      expect(
        calculator.calculate(10_000, {
          discountType: discountType as PromotionDiscount['discountType'],
          value: 2500,
        }),
      ).toEqual({ ok: false, reason: 'unknown discount type' });
    }
  });

  it('reports an unknown discount type instead of throwing', () => {
    expect(
      calculator.calculate(10_000, {
        discountType: 'tiered' as PromotionDiscount['discountType'],
        value: 2500,
      }),
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
