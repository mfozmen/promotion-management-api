import { bigint, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { chunkStatus } from './chunk-status.js';
import { ingestionJobs } from './ingestion-jobs.js';

export const ingestionChunks = pgTable(
  'ingestion_chunks',
  {
    jobId: bigint('job_id', { mode: 'number' })
      .notNull()
      .references(() => ingestionJobs.id),
    chunkIndex: integer('chunk_index').notNull(),
    startOffset: bigint('start_offset', { mode: 'number' }).notNull(),
    endOffset: bigint('end_offset', { mode: 'number' }).notNull(),
    nextOffset: bigint('next_offset', { mode: 'number' }).notNull(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    failures: integer('failures').notNull().default(0),
    rowsProcessed: integer('rows_processed').notNull().default(0),
    rowsRejected: integer('rows_rejected').notNull().default(0),
    status: chunkStatus('status').notNull().default('pending'),
    lastError: text('last_error'),
  },
  (table) => [primaryKey({ columns: [table.jobId, table.chunkIndex] })],
);
