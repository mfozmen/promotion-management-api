import { describe, expect, it } from 'vitest';
import { productUpserted } from '@src/modules/catalog/events/product-upserted.js';
import { loadConfig } from '@src/shared/config.js';

const ids = (count: number): number[] => Array.from({ length: count }, (_, index) => index + 1);

describe('productUpserted', () => {
  it('carries exactly what one ingestion batch may commit', () => {
    // Two numbers in two files: a batch that commits more ids than an announcement may
    // carry would dead-letter its own event after the rows are already in PostgreSQL.
    const env = {
      DATABASE_URL: 'postgres://promo:promo@localhost:5432/promotion',
      REDIS_URL: 'redis://localhost:6379',
    };
    const ceiling = loadConfig({ ...env, INGESTION_BATCH_SIZE: '5000' }).INGESTION_BATCH_SIZE;

    expect(() => productUpserted.parse({ productIds: ids(ceiling) })).not.toThrow();
    expect(() => productUpserted.parse({ productIds: ids(ceiling + 1) })).toThrow();
    expect(() => loadConfig({ ...env, INGESTION_BATCH_SIZE: String(ceiling + 1) })).toThrow();
  });

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
