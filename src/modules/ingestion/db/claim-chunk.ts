import { and, eq, or, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import type { ClaimedChunk } from '../domain/dto/claimed-chunk.js';
import { ingestionChunks } from './schema/ingestion-chunks.js';

/**
 * Takes a chunk for this invocation, or returns null because someone else holds it.
 *
 * One guarded `UPDATE` is the whole mechanism: the `WHERE` admits a chunk that is
 * pending, or one whose lease has expired because its worker was killed, and the
 * statement that decides is the statement that writes. Two invocations racing an
 * expired lease both run it and exactly one matches a row (REVIEW.md 3.1).
 *
 * Duplicate `chunk.process` jobs are expected rather than exceptional — the
 * registration step enqueues one per chunk and a redelivery costs nothing — so
 * the null return is the ordinary path, not an error.
 *
 * `next_offset` comes back rather than `start_offset`: a reclaimed chunk resumes
 * at its last committed batch, which is what makes a kill mid-file cost one batch
 * instead of the whole chunk.
 *
 * `lease_until` comes back as the holder's proof. There is no separate token: the
 * lease this statement wrote is unique to this claim because `now()` advances, and
 * an invocation that cannot show it is not the holder any more.
 */
export async function claimChunk(
  db: Db,
  jobId: number,
  chunkIndex: number,
  leaseMs: number,
): Promise<ClaimedChunk | null> {
  const [claimed] = await db
    .update(ingestionChunks)
    .set({
      status: 'running',
      // Truncated to milliseconds because the lease doubles as the holder's proof
      // and JavaScript's Date cannot hold PostgreSQL's microseconds: an untruncated
      // lease comes back rounded, never equals the stored value, and the holder
      // fails to prove it is the holder.
      leaseUntil: sql`date_trunc('milliseconds', now() + make_interval(secs => ${leaseMs / 1000}))`,
      attempts: sql`${ingestionChunks.attempts} + 1`,
    })
    .where(
      and(
        eq(ingestionChunks.jobId, jobId),
        eq(ingestionChunks.chunkIndex, chunkIndex),
        or(
          eq(ingestionChunks.status, 'pending'),
          and(
            eq(ingestionChunks.status, 'running'),
            or(isNull(ingestionChunks.leaseUntil), lt(ingestionChunks.leaseUntil, sql`now()`)),
          ),
        ),
      ),
    )
    .returning({
      jobId: ingestionChunks.jobId,
      chunkIndex: ingestionChunks.chunkIndex,
      startOffset: ingestionChunks.startOffset,
      endOffset: ingestionChunks.endOffset,
      nextOffset: ingestionChunks.nextOffset,
      leaseUntil: ingestionChunks.leaseUntil,
      attempts: ingestionChunks.attempts,
      failures: ingestionChunks.failures,
    });

  if (claimed === undefined) return null;
  // The `SET` above writes a lease on every claim, so the column is non-null here
  // even though it is nullable in the table — a chunk that has never been claimed
  // has no lease. Narrowing it at the boundary keeps the holder's proof a `Date`
  // rather than something every caller has to re-check.
  return { ...claimed, leaseUntil: claimed.leaseUntil as Date };
}
