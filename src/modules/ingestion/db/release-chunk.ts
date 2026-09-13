import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { ingestionChunks } from './schema/ingestion-chunks.js';

/**
 * Hands a chunk back before its lease would have expired, for an invocation that
 * ran out of time budget rather than out of rows.
 *
 * Without it the invocation that stopped still holds the lease, and the
 * `chunk.process` job it just enqueued finds the chunk busy and returns having
 * done nothing — the import would stall for a lease duration on every budget
 * window instead of continuing in the next one.
 *
 * `status = 'running'` in the `WHERE` keeps it from resurrecting a chunk that
 * finished, and `lease_until` keeps it from releasing one somebody else holds.
 * Both matter: an invocation that ran past its lease inside a single batch is no
 * longer the holder, and its own batch can still commit — the winner has not moved
 * `next_offset` yet — so it reaches this hand-off and would hand back a chunk
 * another invocation is working. Releasing is giving back what you hold, and
 * holding is proved rather than assumed from the status.
 */
export async function releaseChunk(
  db: Db,
  jobId: number,
  chunkIndex: number,
  leaseUntil: Date,
): Promise<void> {
  await db
    .update(ingestionChunks)
    .set({ status: 'pending', leaseUntil: sql`null` })
    .where(
      and(
        eq(ingestionChunks.jobId, jobId),
        eq(ingestionChunks.chunkIndex, chunkIndex),
        eq(ingestionChunks.status, 'running'),
        eq(ingestionChunks.leaseUntil, leaseUntil),
      ),
    );
}
