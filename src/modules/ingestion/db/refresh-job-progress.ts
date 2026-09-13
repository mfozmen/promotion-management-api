import { eq, sql } from 'drizzle-orm';
import type { Queryable } from '../../../shared/db/client.js';
import { ingestionChunks } from './schema/ingestion-chunks.js';
import { ingestionJobs } from './schema/ingestion-jobs.js';

/**
 * Carries the chunk counters up to the job that owns them.
 *
 * The counts live on `ingestion_chunks`, because that is where the checkpoint
 * that earns them commits. Nothing carried them to `ingestion_jobs`, so the one
 * row an operator reads answered `chunks_done = 0, rows_processed = 0` while the
 * job said `completed` — measured on a real 500 000-row import whose six chunks
 * held exactly 500 000 rows between them.
 *
 * Recomputed from the chunks rather than incremented, so it is idempotent: a
 * chunk replayed after a kill, or two invocations calling this at once, cannot
 * double-count. The cost is an aggregate over one job's chunks, which is a
 * handful of rows, and it is paid once per finished chunk rather than per batch.
 */
export async function refreshJobProgress(db: Queryable, jobId: number): Promise<void> {
  await db
    .update(ingestionJobs)
    .set({
      chunksDone: sql`(select count(*) from ${ingestionChunks}
        where ${ingestionChunks.jobId} = ${jobId} and ${ingestionChunks.status} = 'done')`,
      rowsProcessed: sql`(select coalesce(sum(${ingestionChunks.rowsProcessed}), 0)
        from ${ingestionChunks} where ${ingestionChunks.jobId} = ${jobId})`,
      rowsRejected: sql`(select coalesce(sum(${ingestionChunks.rowsRejected}), 0)
        from ${ingestionChunks} where ${ingestionChunks.jobId} = ${jobId})`,
      updatedAt: sql`now()`,
    })
    .where(eq(ingestionJobs.id, jobId));
}
