import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import type { BatchCheckpoint } from '../domain/dto/batch-checkpoint.js';
import { ingestionChunks } from './schema/ingestion-chunks.js';

/**
 * Moves the checkpoint forward, but only from the offset the caller read.
 *
 * `where next_offset = $seen` is the compare-and-set the whole resume story rests
 * on. Two invocations can hold a chunk at once — an expired lease is a guess, not
 * a fact — and without this the loser would rewind the checkpoint and every row
 * between the two offsets would be processed a second time. The upsert makes that
 * invisible in the catalogue, which is why the guard is here rather than trusted
 * to the lease.
 *
 * Returning `false` is an ordinary outcome: the caller rolls back its batch and
 * returns, because someone else owns the chunk now.
 *
 * The counts are added rather than assigned, so `rows_processed` is exact across
 * a chunk that took several invocations to finish.
 */
export async function checkpointBatch(db: Db, batch: BatchCheckpoint): Promise<boolean> {
  const moved = await db
    .update(ingestionChunks)
    .set({
      nextOffset: batch.nextOffset,
      rowsProcessed: sql`${ingestionChunks.rowsProcessed} + ${batch.rowsProcessed}`,
      rowsRejected: sql`${ingestionChunks.rowsRejected} + ${batch.rowsRejected}`,
      status: sql`case when ${batch.nextOffset} >= ${ingestionChunks.endOffset} then 'done'::chunk_status else ${ingestionChunks.status} end`,
    })
    .where(
      and(
        eq(ingestionChunks.jobId, batch.jobId),
        eq(ingestionChunks.chunkIndex, batch.chunkIndex),
        eq(ingestionChunks.nextOffset, batch.seenOffset),
      ),
    )
    .returning({ chunkIndex: ingestionChunks.chunkIndex });

  return moved.length === 1;
}
