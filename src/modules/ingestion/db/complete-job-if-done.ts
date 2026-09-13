import { and, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { ingestionChunks } from './schema/ingestion-chunks.js';
import { ingestionJobs } from './schema/ingestion-jobs.js';

/**
 * Marks the job completed when the chunk that just landed was its last, and says
 * whether this call is the one that made the transition.
 *
 * Every chunk calls it as it finishes, so the last few race. One guarded `UPDATE`
 * settles it: the `WHERE` carries both the "no chunk left undone" test and
 * `status = 'running'`, so exactly one caller matches a row and a second sees
 * `false` (REVIEW.md 3.1). A caller that treated a repeated write as success would
 * announce a finished import once per racing chunk.
 *
 * `status = 'running'` also keeps a failed or aborted job from being completed by
 * a straggler finishing its chunk.
 */
export async function completeJobIfDone(db: Db, jobId: number): Promise<boolean> {
  const completed = await db
    .update(ingestionJobs)
    .set({
      status: 'completed',
      // The counters go in the statement that completes the job, not before it.
      // A separate refresh is ordered by whichever invocation ran last, and that
      // is not necessarily the one that finished last: a real 500 000-row run
      // ended `completed` with `chunks_done = 5` and 441 336 of 500 000 rows,
      // because the last refresh to execute caught another chunk mid-flight.
      // This `UPDATE` only matches when every chunk is done, so what it reads is
      // final by construction.
      chunksDone: sql`(select count(*) from ${ingestionChunks}
        where ${ingestionChunks.jobId} = ${jobId} and ${ingestionChunks.status} = 'done')`,
      rowsProcessed: sql`(select coalesce(sum(${ingestionChunks.rowsProcessed}), 0)
        from ${ingestionChunks} where ${ingestionChunks.jobId} = ${jobId})`,
      rowsRejected: sql`(select coalesce(sum(${ingestionChunks.rowsRejected}), 0)
        from ${ingestionChunks} where ${ingestionChunks.jobId} = ${jobId})`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(ingestionJobs.id, jobId),
        eq(ingestionJobs.status, 'running'),
        sql`not exists (
          select 1 from ${ingestionChunks}
          where ${ingestionChunks.jobId} = ${jobId}
            and ${ne(ingestionChunks.status, 'done')}
        )`,
      ),
    )
    .returning({ id: ingestionJobs.id });

  return completed.length === 1;
}
