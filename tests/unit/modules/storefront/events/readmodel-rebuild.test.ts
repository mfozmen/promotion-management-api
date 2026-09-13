import { describe, expect, it } from 'vitest';
import { readModelRebuild } from '@src/modules/storefront/events/readmodel-rebuild.js';

describe('readModelRebuild', () => {
  it('accepts a scoped and an unscoped rebuild', () => {
    expect(readModelRebuild.parse({})).toEqual({});
    expect(readModelRebuild.parse({ category: 'shoes' })).toEqual({ category: 'shoes' });
  });

  it('trims a category so a blank one cannot become a SCAN prefix', () => {
    expect(readModelRebuild.parse({ category: '  shoes  ' })).toEqual({ category: 'shoes' });
    expect(() => readModelRebuild.parse({ category: '   ' })).toThrow();
  });

  it.each([
    ['an empty category', { category: '' }],
    ['a non-string category', { category: 1 }],
    ['an unknown field', { category: 'shoes', extra: 1 }],
  ])('rejects %s', (_reason, payload) => {
    expect(() => readModelRebuild.parse(payload)).toThrow();
  });
});
