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
   * Stores a batch of priced rows and returns their ids. One statement per batch,
   * keyed on the vendor's `sku`, so replaying a chunk after a kill is harmless.
   * `db` is a parameter because the caller owns the transaction.
   */
  async upsertMany(db: Queryable, batch: readonly ProductUpsert[]): Promise<readonly number[]> {
    // PostgreSQL refuses to let one ON CONFLICT statement touch a row twice, so a
    // SKU repeated inside a batch is deduped rather than failing the rows around it.
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
        // last: chunks are claimed independently, so write order is not offset order.
        //
        // The null branch is named rather than implied — a row comparison against
        // NULL is NULL, not true, so the guard alone would silently never update a
        // product created through the API, which has both columns null.
        //
        // The value comparison is what stops a weekly re-import rewriting a
        // catalogue that did not change. `IS DISTINCT FROM` because a column going
        // to or from null is a change and `null <> null` is null.
        setWhere: sql`(${products.ingestJobId} is null
            or (excluded.ingest_job_id, excluded.ingest_source_offset)
               > (${products.ingestJobId}, ${products.ingestSourceOffset}))
          and (${products.name}, ${products.category}, ${products.basePriceCents},
               ${products.stockQuantity}, ${products.pricingRulesVersion})
              is distinct from
              (excluded.name, excluded.category, excluded.base_price_cents,
               excluded.stock_quantity, excluded.pricing_rules_version)`,
      })
      .returning({ sku: products.sku, id: products.id });

    // `RETURNING` follows write order, not the order the rows were given.
    const byTheirSku = new Map(stored.map((row) => [row.sku, row.id]));

    // A skipped row returns nothing and the caller still has to announce it:
    // fewer ids than rows puts `undefined` into an already-committed batch's event.
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
