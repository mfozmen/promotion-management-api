import { describe, expect, it } from 'vitest';
import { ingestionChunk } from '@src/modules/ingestion/domain/dto/ingestion-chunk.js';
import { productUpserted } from '@src/modules/catalog/domain/dto/product-upserted.js';
import { promotionChanged } from '@src/modules/promotion/domain/dto/promotion-changed.js';
import { eventSchemas } from '@src/shared/event-schemas.js';
import { readmodelRebuild } from '@src/shared/readmodel-rebuild.js';
import { reconcileRun } from '@src/shared/reconcile-run.js';

// The registry only maps names to schemas; each schema is tested beside its source.
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

  it('points each name at the schema its producing module owns', () => {
    expect(eventSchemas).toEqual({
      'product.upserted': productUpserted,
      'promotion.changed': promotionChanged,
      'readmodel.rebuild': readmodelRebuild,
      'reconcile.run': reconcileRun,
      'ingestion.chunk': ingestionChunk,
    });
  });
});
