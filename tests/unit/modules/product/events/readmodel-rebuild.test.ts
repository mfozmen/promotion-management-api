import { describe, expect, it } from 'vitest';
import { readmodelRebuild } from '@src/modules/product/events/readmodel-rebuild.js';

describe('readmodelRebuild', () => {
  it('accepts a scoped and an unscoped rebuild', () => {
    expect(readmodelRebuild.parse({})).toEqual({});
    expect(readmodelRebuild.parse({ category: 'shoes' })).toEqual({ category: 'shoes' });
  });

  it('trims a category so a blank one cannot become a SCAN prefix', () => {
    expect(readmodelRebuild.parse({ category: '  shoes  ' })).toEqual({ category: 'shoes' });
    expect(() => readmodelRebuild.parse({ category: '   ' })).toThrow();
  });

  it.each([
    ['an empty category', { category: '' }],
    ['a non-string category', { category: 1 }],
    ['an unknown field', { category: 'shoes', extra: 1 }],
  ])('rejects %s', (_reason, payload) => {
    expect(() => readmodelRebuild.parse(payload)).toThrow();
  });
});
