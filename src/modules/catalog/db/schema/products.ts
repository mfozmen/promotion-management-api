import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const products = pgTable(
  'products',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    sku: text('sku').notNull().unique(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    basePriceCents: bigint('base_price_cents', { mode: 'number' }).notNull(),
    stockQuantity: integer('stock_quantity').notNull(),
    pricingRulesVersion: bigint('pricing_rules_version', { mode: 'number' }),
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
