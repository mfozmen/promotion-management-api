import { productUpserted } from '../modules/catalog/domain/dto/product-upserted.js';
import { ingestionChunk } from '../modules/ingestion/domain/dto/ingestion-chunk.js';
import { promotionChanged } from '../modules/promotion/domain/dto/promotion-changed.js';
import { readmodelRebuild } from '../modules/product/domain/dto/readmodel-rebuild.js';
import { reconcilerRun } from './reconciler-run.js';

/** The application's event catalogue; it sits above the modules, not in `shared/`. ADR-0008. */
export const eventRegistry = {
  'product.upserted': productUpserted,
  'promotion.changed': promotionChanged,
  'readmodel.rebuild': readmodelRebuild,
  'reconciler.run': reconcilerRun,
  'ingestion.chunk': ingestionChunk,
} as const;
