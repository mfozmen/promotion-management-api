import { describe, expect, it } from 'vitest';
import {
  adjustmentFor,
  applyPromotions,
  isActive,
  type AdjustmentEvent,
  type Promotion,
} from '../../src/modules/pricing/effective-price.js';

const NOW = new Date('2026-09-12T12:00:00.000Z');
const MS = 1;

const percent = (value: number): AdjustmentEvent => ({
  type: 'adjustPercentBps',
  params: { value },
});
const cents = (value: number): AdjustmentEvent => ({ type: 'adjustCents', params: { value } });

function promotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    status: 'active',
    startsAt: new Date('2026-09-12T00:00:00.000Z'),
    endsAt: new Date('2026-09-13T00:00:00.000Z'),
    ...overrides,
  };
}

function priced(basePriceCents: number, event: AdjustmentEvent | null): number {
  const outcome = applyPromotions(basePriceCents, event);

  expect(outcome.ok).toBe(true);
  return outcome.effectivePriceCents;
}

describe('adjustmentFor', () => {
  it('has a strategy for every event type the rules may emit', () => {
    expect(adjustmentFor('adjustPercentBps')).toBeDefined();
    expect(adjustmentFor('adjustCents')).toBeDefined();
  });

  it('has no strategy for a type nothing implements', () => {
    expect(adjustmentFor('adjustNothing')).toBeUndefined();
  });

  it('exposes the arithmetic itself, so ingestion can run it without this price path', () => {
    // Ingestion runs several of these in priority order over one price;
    // promotions run the winning one. One implementation, two callers.
    const percentBps = adjustmentFor('adjustPercentBps');
    const minorUnits = adjustmentFor('adjustCents');

    expect(percentBps?.apply(10_000n, { value: -2500 })).toBe(7500n);
    expect(percentBps?.apply(10_000n, { value: 1500 })).toBe(11_500n);
    expect(minorUnits?.apply(10_000n, { value: -2500 })).toBe(7500n);
    expect(minorUnits?.apply(10_000n, { value: 1500 })).toBe(11_500n);
    expect(minorUnits?.validate(1500)).toBeNull();
  });
});

describe('applyPromotions', () => {
  it('applies a percentage adjustment in basis points', () => {
    expect(priced(10_000, percent(-2500))).toBe(7500);
  });

  it('applies a fixed adjustment in minor units', () => {
    expect(priced(10_000, cents(-2500))).toBe(7500);
  });

  it('floors the price, so the customer never pays a fraction of a minor unit', () => {
    // 75 % of 999 is 749.25. The floor is on the price, not on the discount,
    // because the ingestion strategy this shares floors a markup the same way.
    expect(priced(999, percent(-2500))).toBe(749);
    expect(priced(1000, percent(-3333))).toBe(666);
  });

  it('returns zero for a 100 % discount', () => {
    expect(priced(10_000, percent(-10_000))).toBe(0);
  });

  it('returns zero for a fixed discount larger than the base price', () => {
    expect(priced(500, cents(-800))).toBe(0);
  });

  it('returns zero for a zero base price', () => {
    expect(priced(0, percent(-2500))).toBe(0);
    expect(priced(0, cents(-800))).toBe(0);
  });

  it('returns the base price when no rule fired', () => {
    expect(priced(10_000, null)).toBe(10_000);
  });

  it('returns the base price for an adjustment of zero', () => {
    expect(priced(10_000, percent(0))).toBe(10_000);
    expect(priced(10_000, cents(0))).toBe(10_000);
  });

  it('never raises a price above the base, whatever the rule asked for', () => {
    // The vocabulary is shared with ingestion, where a markup is the point;
    // on the promotion path it is clamped away (REVIEW.md 1.5).
    expect(priced(10_000, percent(1500))).toBe(10_000);
    expect(priced(10_000, cents(500))).toBe(10_000);
  });

  it('is exact at the largest price the money representation allows', () => {
    // The ceiling of the `mode: 'number'` price columns. In doubles the
    // intermediate product is far outside the exact-integer range.
    expect(priced(Number.MAX_SAFE_INTEGER, percent(-5000))).toBe(4_503_599_627_370_495);
  });

  it('is exact at a large price where double arithmetic would round', () => {
    expect(priced(4_171_863_899_102, percent(-7049))).toBe(1_231_117_036_625);
  });

  it('skips an event naming a type no strategy implements, keeping the base price', () => {
    expect(applyPromotions(10_000, { type: 'adjustKarma', params: { value: -2500 } })).toEqual({
      ok: false,
      effectivePriceCents: 10_000,
      reason: 'unknown adjustment type "adjustKarma"',
    });
  });

  it('rejects an adjustment value that is not a whole number in range', () => {
    for (const event of [percent, cents]) {
      for (const value of [-2500.5, NaN, Infinity, -Infinity, 2 ** 53]) {
        expect(applyPromotions(10_000, event(value))).toEqual({
          ok: false,
          effectivePriceCents: 10_000,
          reason: `adjustment value ${value} is not a whole number in range`,
        });
      }
    }
  });

  it('rejects a percentage below -10 000 basis points rather than pricing it', () => {
    expect(applyPromotions(10_000, percent(-10_001))).toEqual({
      ok: false,
      effectivePriceCents: 10_000,
      reason: 'percentage adjustment -10001 is below -10000 basis points',
    });
  });

  it('rejects a base price that is not a whole, non-negative number of minor units', () => {
    for (const event of [null, percent(-2500), cents(-2500)]) {
      for (const basePriceCents of [1000.5, NaN, Infinity, -Infinity, -500, 2 ** 53]) {
        expect(applyPromotions(basePriceCents, event)).toEqual({
          ok: false,
          effectivePriceCents: 0,
          reason: `base price ${basePriceCents} is not a whole number of minor units in range`,
        });
      }
    }
  });

  it('never returns a price outside [0, base] for any adjustment it accepts', () => {
    for (const value of [-10_000, -2500, -1, 0, 1, 20_000]) {
      for (const event of [percent, cents]) {
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
