import { describe, expect, it } from 'vitest';
import { ingestionChunk } from '@src/modules/ingestion/domain/dto/ingestion-chunk.js';
import { productUpserted } from '@src/modules/catalog/domain/dto/product-upserted.js';
import { promotionChanged } from '@src/modules/promotion/domain/dto/promotion-changed.js';
import { eventRegistry } from '@src/events/event-registry.js';
import { readmodelRebuild } from '@src/events/readmodel-rebuild.js';
import { reconcileRun } from '@src/events/reconcile-run.js';

// The eventRegistry only maps names to schemas; each schema is tested beside its source.
describe('eventRegistry', () => {
  it('names exactly the events the design table lists', () => {
    expect(Object.keys(eventRegistry).sort()).toEqual([
      'ingestion.chunk',
      'product.upserted',
      'promotion.changed',
      'readmodel.rebuild',
      'reconcile.run',
    ]);
  });

  it('points each name at the schema its producing module owns', () => {
    expect(eventRegistry).toEqual({
      'product.upserted': productUpserted,
      'promotion.changed': promotionChanged,
      'readmodel.rebuild': readmodelRebuild,
      'reconcile.run': reconcileRun,
      'ingestion.chunk': ingestionChunk,
    });
  });
});
