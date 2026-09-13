import { describe, expect, it } from 'vitest';
import { promotionChanged } from '@src/modules/promotion/events/promotion-changed.js';

describe('promotionChanged', () => {
  it('accepts a valid payload unchanged', () => {
    expect(promotionChanged.parse({ promotionId: 42 })).toEqual({ promotionId: 42 });
  });

  it.each([
    ['a negative id', { promotionId: -1 }],
    ['a zero id', { promotionId: 0 }],
    ['a fractional id', { promotionId: 1.5 }],
    ['a missing field', {}],
    ['an unknown field', { promotionId: 1, extra: true }],
  ])('rejects %s', (_reason, payload) => {
    expect(() => promotionChanged.parse(payload)).toThrow();
  });
});
