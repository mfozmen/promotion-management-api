import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { ingestionChunks } from './schema/ingestion-chunks.js';

/**
 * Hands a chunk back before its lease would have expired, for an invocation that
 * ran out of time budget rather than out of rows.
 *
 * Without it the invocation that stopped still holds the lease, and the
 * `ingestion.chunk` job it just enqueued finds the chunk busy and returns having
 * done nothing — the import would stall for a lease duration on every budget
 * window instead of continuing in the next one.
 *
 * `status = 'running'` in the `WHERE` is what keeps it from resurrecting a chunk
 * that finished: releasing is giving back what you hold, never reopening.
 */
export async function releaseChunk(db: Db, jobId: number, chunkIndex: number): Promise<void> {
  await db
    .update(ingestionChunks)
    .set({ status: 'pending', leaseUntil: sql`null` })
    .where(
      and(
        eq(ingestionChunks.jobId, jobId),
        eq(ingestionChunks.chunkIndex, chunkIndex),
        eq(ingestionChunks.status, 'running'),
      ),
    );
}
