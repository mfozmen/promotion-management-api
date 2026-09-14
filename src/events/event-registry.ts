import { productUpserted } from '../modules/product/events/product-upserted.js';
import { chunkProcess } from '../modules/ingestion/events/chunk-process.js';
import { promotionChanged } from '../modules/promotion/events/promotion-changed.js';
import { readModelRebuild } from '../modules/storefront/events/readmodel-rebuild.js';
import { reconcilerRun } from '../modules/reconciler/events/reconciler-run.js';

/** The application's event catalogue; it sits above the modules, not in `shared/`. ADR-0008. */
export const eventRegistry = {
  'product.upserted': productUpserted,
  'promotion.changed': promotionChanged,
  'readmodel.rebuild': readModelRebuild,
  'reconciler.run': reconcilerRun,
  'chunk.process': chunkProcess,
} as const;
