import { productUpserted } from '../modules/catalog/domain/dto/product-upserted.js';
import { ingestionChunk } from '../modules/ingestion/domain/dto/ingestion-chunk.js';
import { promotionChanged } from '../modules/promotion/domain/dto/promotion-changed.js';
import { readmodelRebuild } from './readmodel-rebuild.js';
import { reconcileRun } from './reconcile-run.js';

/** The application's event catalogue; it sits above the modules, not in `shared/`. ADR-0008. */
export const registry = {
  'product.upserted': productUpserted,
  'promotion.changed': promotionChanged,
  'readmodel.rebuild': readmodelRebuild,
  'reconcile.run': reconcileRun,
  'ingestion.chunk': ingestionChunk,
} as const;
