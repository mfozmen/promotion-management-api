import { sql } from 'drizzle-orm';
import { bigint, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { ingestionStatus } from './ingestion-status.js';

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
