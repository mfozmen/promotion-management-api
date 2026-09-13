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
