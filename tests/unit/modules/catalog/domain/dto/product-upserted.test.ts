import { describe, expect, it } from 'vitest';
import { productUpserted } from '@src/modules/catalog/domain/dto/product-upserted.js';

describe('productUpserted', () => {
  it('accepts a valid payload unchanged', () => {
    expect(productUpserted.parse({ productIds: [1, 2, 3] })).toEqual({ productIds: [1, 2, 3] });
  });

  it('carries a full ingestion batch, so a chunk cannot announce what it committed', () => {
    const full = Array.from({ length: 5000 }, (_, index) => index + 1);

    expect(productUpserted.parse({ productIds: full }).productIds).toHaveLength(5000);
  });

  it.each([
    ['an empty id list', { productIds: [] }],
    ['more than a batch', { productIds: Array.from({ length: 5001 }, (_, i) => i + 1) }],
    ['a non-positive id', { productIds: [0] }],
    ['a fractional id', { productIds: [1.5] }],
    ['a string id', { productIds: ['1'] }],
    ['a missing field', {}],
    ['an unknown field', { productIds: [1], extra: true }],
  ])('rejects %s', (_reason, payload) => {
    expect(() => productUpserted.parse(payload)).toThrow();
  });
});
