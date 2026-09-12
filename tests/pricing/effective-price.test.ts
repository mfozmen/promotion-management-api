import { describe, expect, it } from 'vitest';
import {
  applyPromotion,
  isActive,
  resolveApplied,
  type Promotion,
} from '../../src/modules/pricing/effective-price.js';

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

describe('applyPromotion', () => {
  it('applies a percentage discount in basis points', () => {
    expect(applyPromotion(10_000, promotion({ value: 2500 }))).toBe(7500);
  });

  it('floors the discount so the customer pays at most one cent more', () => {
    expect(applyPromotion(1000, promotion({ value: 3333 }))).toBe(667);
  });

  it('floors a discount of exactly half a cent', () => {
    expect(applyPromotion(999, promotion({ value: 5000 }))).toBe(500);
  });

  it('returns zero for a 100 % percentage discount', () => {
    expect(applyPromotion(10_000, promotion({ value: 10_000 }))).toBe(0);
  });

  it('applies a fixed discount in cents', () => {
    expect(applyPromotion(10_000, promotion({ discountType: 'fixed', value: 2500 }))).toBe(7500);
  });

  it('clamps a fixed discount larger than the base price to zero', () => {
    expect(applyPromotion(500, promotion({ discountType: 'fixed', value: 800 }))).toBe(0);
  });

  it('returns zero for a zero base price', () => {
    expect(applyPromotion(0, promotion({ value: 2500 }))).toBe(0);
    expect(applyPromotion(0, promotion({ discountType: 'fixed', value: 800 }))).toBe(0);
  });

  it('returns the base price when there is no applied promotion', () => {
    expect(applyPromotion(10_000, null)).toBe(10_000);
  });

  it('floors exactly at the largest price the money representation allows', () => {
    // The ceiling of the `mode: 'number'` price columns. This one floors
    // correctly in doubles too; the case below is the discriminating one.
    expect(applyPromotion(Number.MAX_SAFE_INTEGER, promotion({ value: 5000 }))).toBe(
      4_503_599_627_370_496,
    );
  });

  it('floors a large price where double arithmetic rounds the discount up', () => {
    // In doubles this discount floors to 2940746862477, one cent too much.
    expect(applyPromotion(4_171_863_899_102, promotion({ value: 7049 }))).toBe(1_231_117_036_626);
  });

  it('never returns more than the base price', () => {
    expect(applyPromotion(10_000, promotion({ value: -2500 }))).toBe(10_000);
    expect(applyPromotion(10_000, promotion({ discountType: 'fixed', value: -500 }))).toBe(10_000);
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

  it('is never active for a draft', () => {
    expect(isActive(promotion({ status: 'draft' }), NOW)).toBe(false);
  });

  it('is never active for a cancelled promotion', () => {
    expect(isActive(promotion({ status: 'cancelled' }), NOW)).toBe(false);
  });
});

describe('resolveApplied', () => {
  it('applies the product-level promotion when both levels are active', () => {
    const product = promotion({ value: 1000 });
    const category = promotion({ value: 5000 });

    expect(resolveApplied(product, category, NOW)).toBe(product);
  });

  it('applies the product-level promotion even when the category discount is larger', () => {
    const product = promotion({ value: 1000 });
    const category = promotion({ value: 9000 });

    expect(applyPromotion(10_000, resolveApplied(product, category, NOW))).toBe(9000);
  });

  it('applies the category-level promotion when there is no product-level one', () => {
    const category = promotion();

    expect(resolveApplied(null, category, NOW)).toBe(category);
  });

  it('applies the category-level promotion when the product-level one is not active', () => {
    const product = promotion({ endsAt: NOW });
    const category = promotion();

    expect(resolveApplied(product, category, NOW)).toBe(category);
  });

  it('applies nothing when the category-level promotion is not active either', () => {
    const product = promotion({ status: 'draft' });
    const category = promotion({ status: 'cancelled' });

    expect(resolveApplied(product, category, NOW)).toBeNull();
  });

  it('applies nothing and keeps the base price when there is no promotion at all', () => {
    expect(resolveApplied(null, null, NOW)).toBeNull();
    expect(applyPromotion(10_000, resolveApplied(null, null, NOW))).toBe(10_000);
  });
});
