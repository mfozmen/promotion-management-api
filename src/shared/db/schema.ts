import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Drizzle cannot express `exclude using gist`; the two promotion constraints and the
// btree_gist extension live in migration 0000 only. Keep both sides in step (REVIEW.md 11.4).

export const promotionStatus = pgEnum('promotion_status', ['draft', 'active', 'cancelled']);
export const pricingRuleType = pgEnum('pricing_rule_type', ['ingestion', 'promotion']);
export const ingestionStatus = pgEnum('ingestion_status', [
  'running',
  'paused',
  'completed',
  'failed',
  'aborted',
]);
export const chunkStatus = pgEnum('chunk_status', ['pending', 'running', 'done', 'failed']);

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
    pricingRulesVersion: integer('pricing_rules_version'),
    // Written together by the ingestion upsert. The check below removes the one-column-null
    // branch, not every branch: a manually created product has both null, so the last-writer
    // guard still needs `products.ingest_job_id is null or (...) > (...)` (REVIEW.md 2.6).
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

export const promotions = pgTable(
  'promotions',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    name: text('name').notNull(),
    // The registry key of the class that prices this promotion, and that class's own
    // configuration; its zod schema is what bounds the values, not a column check (spec 4).
    calculator: text('calculator').notNull(),
    params: jsonb('params').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    productId: bigint('product_id', { mode: 'number' }).references(() => products.id),
    category: text('category'),
    status: promotionStatus('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => [
    check('promotions_window_check', sql`${table.endsAt} > ${table.startsAt}`),
    check(
      'promotions_active_target_check',
      sql`${table.status} <> 'active' or (${table.productId} is null) <> (${table.category} is null)`,
    ),
    check(
      'promotions_draft_target_check',
      sql`${table.status} <> 'draft' or (${table.productId} is null and ${table.category} is null)`,
    ),
  ],
);

export const pricingRules = pgTable(
  'pricing_rules',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    type: pricingRuleType('type').notNull(),
    name: text('name').notNull().unique(), // lets the seed re-apply without duplicating a rule
    conditions: jsonb('conditions').notNull(),
    event: jsonb('event').notNull(),
    priority: integer('priority').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Serves the loader: one layer's rules, highest priority first.
    index('pricing_rules_active_idx')
      .on(table.type, table.priority.desc())
      .where(sql`${table.active}`),
  ],
);

export const ingestionJobs = pgTable(
  'ingestion_jobs',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    vendor: text('vendor').notNull(),
    fileRef: text('file_ref').notNull(), // path under UPLOAD_DIR, blob key in production
    fileSha256: text('file_sha256').notNull().unique(), // same file twice is a 409, never a second job
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
    chunksTotal: integer('chunks_total').notNull(),
    chunksDone: integer('chunks_done').notNull().default(0),
    rowsProcessed: bigint('rows_processed', { mode: 'number' }).notNull().default(0),
    rowsRejected: bigint('rows_rejected', { mode: 'number' }).notNull().default(0),
    status: ingestionStatus('status').notNull().default('running'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ingestion_jobs_one_running_per_vendor')
      .on(table.vendor)
      .where(sql`${table.status} in ('running', 'paused')`),
  ],
);

export const reconcilerState = pgTable(
  'reconciler_state',
  {
    id: boolean('id').primaryKey().default(true),
    lastBoundarySweepAt: timestamp('last_boundary_sweep_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [check('reconciler_state_single_row_check', sql`${table.id}`)],
);

export const ingestionChunks = pgTable(
  'ingestion_chunks',
  {
    jobId: bigint('job_id', { mode: 'number' })
      .notNull()
      .references(() => ingestionJobs.id),
    chunkIndex: integer('chunk_index').notNull(),
    startOffset: bigint('start_offset', { mode: 'number' }).notNull(), // first line, inclusive
    endOffset: bigint('end_offset', { mode: 'number' }).notNull(), // after the last newline, exclusive
    nextOffset: bigint('next_offset', { mode: 'number' }).notNull(), // durable checkpoint
    leaseUntil: timestamp('lease_until', { withTimezone: true }), // expired means re-claimable
    attempts: integer('attempts').notNull().default(0), // claims, budget hand-offs included
    failures: integer('failures').notNull().default(0), // only errors, and they drive 'failed'
    rowsProcessed: integer('rows_processed').notNull().default(0),
    rowsRejected: integer('rows_rejected').notNull().default(0),
    status: chunkStatus('status').notNull().default('pending'),
    lastError: text('last_error'),
  },
  (table) => [primaryKey({ columns: [table.jobId, table.chunkIndex] })],
);
