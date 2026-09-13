import { inArray, sql } from 'drizzle-orm';
import type { Db, Queryable } from '../../../shared/db/client.js';
import { products } from './schema/products.js';
import { hasSqlState } from '../../../shared/db/has-sql-state.js';
import { SqlState } from '../../../shared/db/sql-state.js';
import type { CreateProduct } from '../domain/dto/create-product-input.js';
import type { InsertProductOutcome } from '../domain/dto/insert-product-outcome.js';
import type { ProductUpsert } from '../domain/dto/product-upsert.js';

export class ProductRepository {
  constructor(private readonly db: Db) {}

  /** A duplicate SKU is decided by the unique index, never by a `SELECT` first:
   *  a check-then-insert only moves the error somewhere less expected. */
  async insert(input: CreateProduct): Promise<InsertProductOutcome> {
    try {
      const rows = await this.db.insert(products).values(input).returning();
      // A single-row insert returns one row or throws, so the result is read as
      // the one-tuple it is rather than guarded for a length that cannot occur.
      const [row] = rows as [(typeof rows)[number]];
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
      if (hasSqlState(error, SqlState.uniqueViolation)) return { ok: false, reason: 'sku-exists' };
      throw error;
    }
  }

  /**
   * Stores a batch of priced rows and returns their ids, for the `product.upserted`
   * announcement the ingestion path sends per batch.
   *
   * One statement per batch, not one per row: an import is 500 000 rows and a
   * round trip each would be the whole cost of the job (ADR-0005).
   *
   * `sku` is the vendor's identity for a product and ours is the surrogate id, so
   * a re-import updates rather than inserts — which is what makes replaying a
   * chunk after a kill harmless.
   *
   * `db` is a parameter rather than the field, because the caller commits this
   * write and its checkpoint in one transaction and the boundary is the caller's
   * to draw.
   */
  async upsertMany(db: Queryable, batch: readonly ProductUpsert[]): Promise<readonly number[]> {
    // PostgreSQL refuses to let one ON CONFLICT statement touch a row twice, and a
    // vendor file repeating a SKU inside one batch is a vendor's mistake rather
    // than a reason to fail the rows around it. The last occurrence wins.
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
        // Resolution is by where the row came from, not by which write committed
        // last: chunks are claimed independently, so the order rows are written
        // is not the order of their offsets (design spec §"not commit order").
        //
        // The null branch is named rather than implied. A row-value comparison
        // against NULL is NULL, not true, so `(a, b) > (c, d)` alone would
        // silently never update a product created through the API, which has
        // both provenance columns null. The schema checks the two columns are
        // null together, so one branch covers both (REVIEW.md 2.6).
        setWhere: sql`${products.ingestJobId} is null
          or (excluded.ingest_job_id, excluded.ingest_source_offset)
             > (${products.ingestJobId}, ${products.ingestSourceOffset})`,
      })
      .returning({ sku: products.sku, id: products.id });

    // `RETURNING` follows the order the rows were written, which is not promised to
    // be the order they were given; the caller's order is what the announcement uses.
    const byTheirSku = new Map(stored.map((row) => [row.sku, row.id]));

    // A row the guard skipped returns nothing, and the caller still has to be able
    // to announce it: the product exists and the read model may not have seen it.
    // Returning fewer ids than rows would put `undefined` in the announcement,
    // which the event schema rejects after the batch has already committed. The
    // extra read happens only when something was skipped, which is the rare path.
    const skipped = rows.filter((row) => !byTheirSku.has(row.sku)).map((row) => row.sku);
    if (skipped.length > 0) {
      const found = await db
        .select({ sku: products.sku, id: products.id })
        .from(products)
        .where(inArray(products.sku, skipped));
      for (const row of found) byTheirSku.set(row.sku, row.id);
    }

    return rows.map((row) => byTheirSku.get(row.sku)!);
  }
}
