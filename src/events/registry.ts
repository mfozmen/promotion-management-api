import { productUpserted } from '../modules/catalog/domain/dto/product-upserted.js';
import { ingestionChunk } from '../modules/ingestion/domain/dto/ingestion-chunk.js';
import { promotionChanged } from '../modules/promotion/domain/dto/promotion-changed.js';
import { readmodelRebuild } from './readmodel-rebuild.js';
import { reconcileRun } from './reconcile-run.js';

/**
 * The application's event catalogue: a name to the schema its producing module owns
 * (ADR-0008). It lives here rather than in `shared/queue/` so the queue stays generic
 * and `shared/` imports no module.
 */
export const registry = {
  'product.upserted': productUpserted,
  'promotion.changed': promotionChanged,
  'readmodel.rebuild': readmodelRebuild,
  'reconcile.run': reconcileRun,
  'ingestion.chunk': ingestionChunk,
} as const;
