import type { Product } from '../domain/product.js';

/**
 * A failure carries no product, so a caller cannot answer 201 with one by
 * mistake. A value rather than a thrown `HttpError` because a module under
 * `src/modules/` has no status to give — the route decides that (ADR-0008).
 */
export type InsertProductOutcome =
  | { ok: true; product: Product }
  | { ok: false; reason: 'sku-exists' };
