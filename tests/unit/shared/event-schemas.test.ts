import { describe, expect, it } from 'vitest';
import type { EventName } from '@src/shared/event-name.js';
import { eventSchemas } from '@src/shared/event-schemas.js';

// The schemas are the contract the producer parses against; `EventBus.publish`
// applies them, which is why these assert the schema rather than the caller.
describe('eventSchemas', () => {
  it('names exactly the events the design table lists', () => {
    expect(Object.keys(eventSchemas).sort()).toEqual([
      'ingestion.chunk',
      'product.upserted',
      'promotion.changed',
      'readmodel.rebuild',
      'reconcile.run',
    ]);
  });

  it.each([
    ['product.upserted', { productIds: [1, 2, 3] }],
    ['promotion.changed', { promotionId: 42 }],
    ['readmodel.rebuild', {}],
    ['readmodel.rebuild', { category: 'shoes' }],
    ['reconcile.run', {}],
    ['ingestion.chunk', { jobId: 7, chunkIndex: 0 }],
  ] as const)('accepts a valid %s payload unchanged', (name, payload) => {
    expect(eventSchemas[name].parse(payload)).toEqual(payload);
  });

  it.each([
    ['product.upserted', 'an empty id list', { productIds: [] }],
    [
      'product.upserted',
      'more than 1000 ids',
      { productIds: Array.from({ length: 1001 }, (_, i) => i + 1) },
    ],
    ['product.upserted', 'a non-positive id', { productIds: [0] }],
    ['product.upserted', 'a fractional id', { productIds: [1.5] }],
    ['product.upserted', 'a string id', { productIds: ['1'] }],
    ['product.upserted', 'a missing field', {}],
    ['promotion.changed', 'a negative id', { promotionId: -1 }],
    ['promotion.changed', 'an unknown field', { promotionId: 1, extra: true }],
    ['readmodel.rebuild', 'an empty category', { category: '' }],
    ['readmodel.rebuild', 'a non-string category', { category: 1 }],
    ['reconcile.run', 'any field at all', { anything: 1 }],
    ['ingestion.chunk', 'a missing chunk index', { jobId: 7 }],
    ['ingestion.chunk', 'a negative chunk index', { jobId: 7, chunkIndex: -1 }],
    ['ingestion.chunk', 'an unknown field', { jobId: 7, chunkIndex: 0, extra: 1 }],
  ] as const)(
    'rejects a %s payload with %s',
    (name: EventName, _reason: string, payload: unknown) => {
      expect(() => eventSchemas[name].parse(payload)).toThrow();
    },
  );

  it('trims a rebuild category so a blank one cannot become a SCAN prefix', () => {
    expect(eventSchemas['readmodel.rebuild'].parse({ category: '  shoes  ' })).toEqual({
      category: 'shoes',
    });
    expect(() => eventSchemas['readmodel.rebuild'].parse({ category: '   ' })).toThrow();
  });

  it('accepts chunk index zero', () => {
    expect(eventSchemas['ingestion.chunk'].parse({ jobId: 1, chunkIndex: 0 }).chunkIndex).toBe(0);
  });
});
