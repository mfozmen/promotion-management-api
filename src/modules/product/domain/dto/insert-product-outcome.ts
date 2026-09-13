import type { Product } from './product.js';

/** A failure carries no product, so a caller cannot answer 201 with one by mistake. */
export type InsertProductOutcome =
  { ok: true; product: Product } | { ok: false; reason: 'sku-exists' };
