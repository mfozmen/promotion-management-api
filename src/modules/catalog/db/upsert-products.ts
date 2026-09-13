import { sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { products } from './schema/products.js';

/** One priced row, ready to store: the vendor's facts plus where they came from. */
export interface ProductUpsert {
  sku: string;
  name: string;
  category: string;
  basePriceCents: number;
  stockQuantity: number;
  pricingRulesVersion: number;
  ingestJobId: number;
  ingestSourceOffset: number;
}

/**
 * Stores a batch of priced rows and returns their ids, for the `product.upserted`
 * announcement that follows the checkpoint.
 *
 * One statement per batch, not one per row: an import is 500 000 rows and a
 * round trip each would be the whole cost of the job (ADR-0005).
 *
 * `sku` is the vendor's identity for a product and ours is the surrogate id, so a
 * re-import updates rather than inserts — which is what makes replaying a chunk
 * after a kill harmless.
 */
export async function upsertProducts(
  db: Db,
  batch: readonly ProductUpsert[],
): Promise<readonly number[]> {
  const rows = [...new Map(batch.map((row) => [row.sku, row])).values()];
  if (rows.length === 0) return [];

  const stored = await db
    .insert(products)
    .values(rows)
    .onConflictDoUpdate({
      target: products.sku,
      set: {
        name: sql`excluded.name`,
        category: sql`excluded.category`,
        basePriceCents: sql`excluded.base_price_cents`,
        stockQuantity: sql`excluded.stock_quantity`,
        pricingRulesVersion: sql`excluded.pricing_rules_version`,
        ingestJobId: sql`excluded.ingest_job_id`,
        ingestSourceOffset: sql`excluded.ingest_source_offset`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ sku: products.sku, id: products.id });

  // `RETURNING` follows the order the rows were written, which is not promised to be
  // the order they were given; the caller's order is the one the announcement uses.
  const byTheirSku = new Map(stored.map((row) => [row.sku, row.id]));
  return rows.map((row) => byTheirSku.get(row.sku)!);
}
