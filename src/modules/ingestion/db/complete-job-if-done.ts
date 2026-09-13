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
    .set({ status: 'completed' })
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
