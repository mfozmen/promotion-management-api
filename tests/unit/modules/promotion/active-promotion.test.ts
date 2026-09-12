import { describe, expect, it } from 'vitest';
import type { ActivePromotion } from '../../../../src/modules/promotion/active-promotion.js';
import { isActive } from '../../../../src/modules/promotion/active-promotion.js';
import type { Promotion } from '../../../../src/modules/promotion/promotion.js';

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

  it('narrows the promotion it accepts to an active one', () => {
    const candidate: Promotion = promotion();
    const status: ActivePromotion['status'] | null = isActive(candidate, NOW)
      ? candidate.status
      : null;

    expect(status).toBe('active');
  });
});
