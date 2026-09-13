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
 * Duplicate `ingestion.chunk` jobs are expected rather than exceptional — the
 * registration step enqueues one per chunk and a redelivery costs nothing — so
 * the null return is the ordinary path, not an error.
 *
 * `next_offset` comes back rather than `start_offset`: a reclaimed chunk resumes
 * at its last committed batch, which is what makes a kill mid-file cost one batch
 * instead of the whole chunk.
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
      leaseUntil: sql`now() + make_interval(secs => ${leaseMs / 1000})`,
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
      attempts: ingestionChunks.attempts,
      failures: ingestionChunks.failures,
    });

  return claimed ?? null;
}
