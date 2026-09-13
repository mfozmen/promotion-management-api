import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const products = pgTable(
  'products',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    sku: text('sku').notNull().unique(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    // mode:'number' reads back through a JS number, so the usable ceiling is
    // Number.MAX_SAFE_INTEGER cents, not the column's. Switch to mode:'bigint' if a price
    // ever needs more than that.
    basePriceCents: bigint('base_price_cents', { mode: 'number' }).notNull(),
    stockQuantity: integer('stock_quantity').notNull(),
    // Null for manual creates; ingestion stamps the rules version it priced the row with.
    // The unit is epoch MILLISECONDS, which is why the column is bigint.
    pricingRulesVersion: bigint('pricing_rules_version', { mode: 'number' }),
    // Written together by the ingestion upsert. The check below removes the one-column-null
    // branch, not every branch: a manually created product has both null, so the last-writer
    // guard still needs `products.ingest_job_id is null or (...) > (...)`.
    ingestJobId: bigint('ingest_job_id', { mode: 'number' }),
    ingestSourceOffset: bigint('ingest_source_offset', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('products_category_id_idx').on(table.category, table.id), // keyset scans per category
    check('products_base_price_cents_check', sql`${table.basePriceCents} >= 0`),
    check('products_stock_quantity_check', sql`${table.stockQuantity} >= 0`),
    check(
      'products_ingest_provenance_check',
      sql`(${table.ingestJobId} is null) = (${table.ingestSourceOffset} is null)`,
    ),
  ],
);
