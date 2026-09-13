import { describe, expect, it } from 'vitest';
import { chunkProcess } from '@src/modules/ingestion/events/chunk-process.js';
import { productUpserted } from '@src/modules/catalog/events/product-upserted.js';
import { promotionChanged } from '@src/modules/promotion/events/promotion-changed.js';
import { eventRegistry } from '@src/events/event-registry.js';
import { readmodelRebuild } from '@src/modules/product/events/readmodel-rebuild.js';
import { reconcilerRun } from '@src/events/reconciler-run.js';

// The eventRegistry only maps names to schemas; each schema is tested beside its source.
describe('eventRegistry', () => {
  it('names exactly the events the design table lists', () => {
    expect(Object.keys(eventRegistry).sort()).toEqual([
      'chunk.process',
      'product.upserted',
      'promotion.changed',
      'readmodel.rebuild',
      'reconciler.run',
    ]);
  });

  it('points each name at the schema its producing module owns', () => {
    expect(eventRegistry).toEqual({
      'product.upserted': productUpserted,
      'promotion.changed': promotionChanged,
      'readmodel.rebuild': readmodelRebuild,
      'reconciler.run': reconcilerRun,
      'chunk.process': chunkProcess,
    });
  });
});
