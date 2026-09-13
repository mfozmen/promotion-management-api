import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { completeJobIfDone } from '@src/modules/ingestion/db/complete-job-if-done.js';
import { refreshJobProgress } from '@src/modules/ingestion/db/refresh-job-progress.js';
import { ingestionChunks } from '@src/modules/ingestion/db/schema/ingestion-chunks.js';
import { ingestionJobs } from '@src/modules/ingestion/db/schema/ingestion-jobs.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

let sequence = 0;

/** A job whose chunks are all `pending` until a test says otherwise. */
async function jobWith(chunks: number): Promise<number> {
  const [job] = await db()
    .insert(ingestionJobs)
    .values({
      vendor: `vendor-${(sequence += 1)}`,
      fileRef: `file-${sequence}.csv`,
      fileSha256: `sha-${sequence}`,
      fileSizeBytes: 1000,
      chunksTotal: chunks,
    })
    .returning();
  await db()
    .insert(ingestionChunks)
    .values(
      Array.from({ length: chunks }, (_, i) => ({
        jobId: job!.id,
        chunkIndex: i,
        startOffset: i * 100,
        endOffset: (i + 1) * 100,
        nextOffset: i * 100,
      })),
    );
  return job!.id;
}

const finish = (jobId: number, chunkIndex: number) =>
  db()
    .update(ingestionChunks)
    .set({ status: 'done' })
    .where(and(eq(ingestionChunks.jobId, jobId), eq(ingestionChunks.chunkIndex, chunkIndex)));

const jobRow = async (jobId: number) => {
  const [row] = await db().select().from(ingestionJobs).where(eq(ingestionJobs.id, jobId));
  return row;
};

describe('refreshJobProgress', () => {
  it('rolls the chunk counters up to the job, so a finished import does not report nothing', async () => {
    // Measured on a real 500 000-row run: six chunks holding 500 000 rows between
    // them, and the job row reading `rows_processed = 0`, `chunks_done = 0`,
    // `status = completed`. The counters live on the chunks and nothing carried
    // them up, so the only row an operator reads said the import did nothing.
    const jobId = await jobWith(2);
    await db()
      .update(ingestionChunks)
      .set({ status: 'done', rowsProcessed: 120, rowsRejected: 3 })
      .where(and(eq(ingestionChunks.jobId, jobId), eq(ingestionChunks.chunkIndex, 0)));
    await db()
      .update(ingestionChunks)
      .set({ rowsProcessed: 40, rowsRejected: 1 })
      .where(and(eq(ingestionChunks.jobId, jobId), eq(ingestionChunks.chunkIndex, 1)));

    await refreshJobProgress(db(), jobId);

    const job = await jobRow(jobId);
    expect(job?.rowsProcessed).toBe(160);
    expect(job?.rowsRejected).toBe(4);
    // Only the chunk that finished counts as done; the other is still running.
    expect(job?.chunksDone).toBe(1);
  });

  it('counts nothing for a job whose chunks have not started', async () => {
    const jobId = await jobWith(2);

    await refreshJobProgress(db(), jobId);

    const job = await jobRow(jobId);
    expect({ done: job?.chunksDone, rows: job?.rowsProcessed }).toEqual({ done: 0, rows: 0 });
  });
});

describe('completeJobIfDone', () => {
  it('completes the job once its last chunk is done', async () => {
    const jobId = await jobWith(2);
    await finish(jobId, 0);
    await finish(jobId, 1);

    expect(await completeJobIfDone(db(), jobId)).toBe(true);
    const job = await jobRow(jobId);
    expect(job?.status).toBe('completed');
    // Final counters come from the statement that completes it, so a completed
    // job never reports fewer rows than its chunks hold.
    expect(job?.chunksDone).toBe(2);
  });

  it('leaves a job running while any chunk is not done', async () => {
    const jobId = await jobWith(2);
    await finish(jobId, 0);

    expect(await completeJobIfDone(db(), jobId)).toBe(false);
    expect((await jobRow(jobId))?.status).toBe('running');
  });

  it('completes exactly once when the last two chunks finish together', async () => {
    // Every chunk calls this as it lands, so the last two race. Completion is a
    // transition and not a repeated write: the second caller must see false, or
    // an announcement hung off it would go out twice.
    const jobId = await jobWith(1);
    await finish(jobId, 0);

    const [first, second] = await Promise.all([
      completeJobIfDone(db(), jobId),
      completeJobIfDone(db(), jobId),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it('does not reopen a job that already failed', async () => {
    const jobId = await jobWith(1);
    await finish(jobId, 0);
    await db().update(ingestionJobs).set({ status: 'failed' }).where(eq(ingestionJobs.id, jobId));

    expect(await completeJobIfDone(db(), jobId)).toBe(false);
    expect((await jobRow(jobId))?.status).toBe('failed');
  });
});
