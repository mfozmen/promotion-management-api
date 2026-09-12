import type { Db } from '../../shared/db/client.js';
import { products } from '../../shared/db/schema.js';
import { isUniqueViolation } from '../../shared/db/unique-violation.js';
import type { CreateProduct } from './create-product-schema.js';
import type { Product } from './product.js';

/**
 * The one write behind `POST /api/products`.
 *
 * A duplicate SKU is decided by the unique index, never by a `SELECT` first:
 * two requests for one new SKU both pass a check-then-insert and one of them
 * still fails at the index, so the check only moves the error somewhere less
 * expected (REVIEW.md 3.1). The outcome is a value rather than a thrown
 * `HttpError` because a module under `src/modules/` has no status to give —
 * the route decides that (ADR-0008).
 */
export async function insertProduct(
  db: Db,
  input: CreateProduct,
): Promise<{ ok: true; product: Product } | { ok: false; reason: 'sku-exists' }> {
  try {
    const [row] = await db.insert(products).values(input).returning();
    // `returning()` on a single-row insert yields exactly one row, or the insert
    // threw. The check is for the type, not for a case that can happen.
    if (!row) throw new Error('insert returned no row');
    return {
      ok: true,
      product: {
        id: row.id,
        sku: row.sku,
        name: row.name,
        category: row.category,
        basePriceCents: row.basePriceCents,
        stockQuantity: row.stockQuantity,
      },
    };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'sku-exists' };
    throw error;
  }
}
