import type { Db } from '../../../shared/db/client.js';
import { products } from './schema/products.js';
import { isUniqueViolation } from '../../../shared/db/unique-violation.js';
import type { CreateProduct } from '../domain/dto/create-product-schema.js';
import type { InsertProductOutcome } from '../domain/dto/insert-product-outcome.js';

/**
 * A duplicate SKU is decided by the unique index, never by a `SELECT` first:
 * two requests for one new SKU both pass a check-then-insert and one of them
 * still fails at the index, so the check only moves the error somewhere less
 * expected (REVIEW.md 3.1).
 */
export async function insertProduct(
  db: Db,
  input: CreateProduct,
): Promise<InsertProductOutcome> {
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
