import { describe, expect, it } from 'vitest';
import {
  applyPromotions,
  CalculatorFactory,
  isActive,
  type DiscountEvent,
  type Promotion,
} from '../../src/modules/pricing/effective-price.js';

const NOW = new Date('2026-09-12T12:00:00.000Z');
const MS = 1;

const percentage = (valueBasisPoints: unknown): DiscountEvent => ({
  type: 'applyDiscount',
  params: { calculator: 'PercentageDiscount', valueBasisPoints },
});
const fixed = (valueCents: unknown): DiscountEvent => ({
  type: 'applyDiscount',
  params: { calculator: 'FixedDiscount', valueCents },
});

function promotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    status: 'active',
    startsAt: new Date('2026-09-12T00:00:00.000Z'),
    endsAt: new Date('2026-09-13T00:00:00.000Z'),
    ...overrides,
  };
}

function priced(basePriceCents: number, event: DiscountEvent | null): number {
  const outcome = applyPromotions(basePriceCents, event);

  expect(outcome.ok).toBe(true);
  return outcome.effectivePriceCents;
}

describe('CalculatorFactory', () => {
  it('resolves every calculator the seeded rules name', () => {
    expect(CalculatorFactory.create('PercentageDiscount')).toBeDefined();
    expect(CalculatorFactory.create('FixedDiscount')).toBeDefined();
  });

  it('resolves nothing for a name the registry does not know', () => {
    expect(CalculatorFactory.create('TieredDiscount')).toBeUndefined();
  });

  it('hands out a calculator that can be run without the price path', () => {
    // The registry is the shared entry point: ingestion runs calculators over
    // a vendor price, promotions run the winning rule's over a base price.
    const percent = CalculatorFactory.create('PercentageDiscount');

    expect(percent?.validate({ valueBasisPoints: 2500 })).toBeNull();
    expect(percent?.calculate(10_000n, { valueBasisPoints: 2500 })).toBe(7500n);
  });

  it('applies no discount when asked to price parameters it rejects', () => {
    // Callers validate first; this is what happens if one forgets, and it is
    // the safe answer rather than a guess.
    const percent = CalculatorFactory.create('PercentageDiscount');

    expect(percent?.calculate(10_000n, { valueBasisPoints: -1 })).toBe(10_000n);
    expect(percent?.calculate(10_000n, null)).toBe(10_000n);
  });
});

describe('applyPromotions', () => {
  it('applies a percentage discount in basis points', () => {
    expect(priced(10_000, percentage(2500))).toBe(7500);
  });

  it('applies a fixed discount in minor units', () => {
    expect(priced(10_000, fixed(2500))).toBe(7500);
  });

  it('floors the discount, so the customer pays at most one minor unit more', () => {
    // 25 % of 999 is 249.75, floored to 249 (ADR-0004, REVIEW.md 1.4).
    expect(priced(999, percentage(2500))).toBe(750);
    expect(priced(1000, percentage(3333))).toBe(667);
  });

  it('returns zero for a 100 % discount', () => {
    expect(priced(10_000, percentage(10_000))).toBe(0);
  });

  it('returns zero for a fixed discount larger than the base price', () => {
    expect(priced(500, fixed(800))).toBe(0);
  });

  it('returns zero for a zero base price', () => {
    expect(priced(0, percentage(2500))).toBe(0);
    expect(priced(0, fixed(800))).toBe(0);
  });

  it('returns the base price when no rule fired', () => {
    expect(priced(10_000, null)).toBe(10_000);
  });

  it('is exact at the largest price the money representation allows', () => {
    // The ceiling of the `mode: 'number'` price columns. In doubles the
    // intermediate product is far outside the exact-integer range.
    expect(priced(Number.MAX_SAFE_INTEGER, percentage(5000))).toBe(4_503_599_627_370_496);
  });

  it('is exact at a large price where double arithmetic would round', () => {
    // In doubles this discount floors to 2940746862477, one cent too much.
    expect(priced(4_171_863_899_102, percentage(7049))).toBe(1_231_117_036_626);
  });

  it('reports a calculator name the registry does not know', () => {
    expect(
      applyPromotions(10_000, {
        type: 'applyDiscount',
        params: { calculator: 'TieredDiscount', valueBasisPoints: 2500 },
      }),
    ).toEqual({
      ok: false,
      effectivePriceCents: 10_000,
      reason: 'unknown calculator "TieredDiscount"',
    });
  });

  it('reports an event that names no calculator at all', () => {
    for (const event of [
      { type: 'applyDiscount' },
      { type: 'applyDiscount', params: null },
      { type: 'applyDiscount', params: { valueBasisPoints: 2500 } },
      { type: 'applyDiscount', params: { calculator: 42 } },
    ]) {
      expect(applyPromotions(10_000, event)).toEqual({
        ok: false,
        effectivePriceCents: 10_000,
        reason: 'event names no calculator',
      });
    }
  });

  it('reports parameters the named calculator rejects', () => {
    for (const value of [2500.5, NaN, Infinity, -2500, 0, '2500', null, undefined]) {
      const percentOutcome = applyPromotions(10_000, percentage(value));
      const fixedOutcome = applyPromotions(10_000, fixed(value));

      expect(percentOutcome.ok).toBe(false);
      expect(fixedOutcome.ok).toBe(false);
      expect(percentOutcome.effectivePriceCents).toBe(10_000);
      expect(fixedOutcome.effectivePriceCents).toBe(10_000);
    }

    // A percentage above 100 % can only be a mistake, so it is rejected rather
    // than clamped to a free product.
    expect(applyPromotions(10_000, percentage(10_001)).ok).toBe(false);
  });

  it('names the calculator that rejected the parameters, for the log', () => {
    const outcome = applyPromotions(10_000, percentage(-1));

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toMatch(
      /^PercentageDiscount rejected its parameters: /,
    );
  });

  it('rejects a base price that is not a whole, non-negative number of minor units', () => {
    for (const event of [null, percentage(2500), fixed(2500)]) {
      for (const basePriceCents of [1000.5, NaN, Infinity, -Infinity, -500, 2 ** 53]) {
        expect(applyPromotions(basePriceCents, event)).toEqual({
          ok: false,
          effectivePriceCents: 0,
          reason: `base price ${basePriceCents} is not a whole number of minor units in range`,
        });
      }
    }
  });

  it('never returns a price outside [0, base] for anything it accepts', () => {
    for (const value of [1, 2500, 10_000]) {
      for (const event of [percentage, fixed]) {
        const outcome = applyPromotions(10_000, event(value));

        expect(outcome.effectivePriceCents).toBeLessThanOrEqual(10_000);
        expect(outcome.effectivePriceCents).toBeGreaterThanOrEqual(0);
      }
    }
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
