import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { claimChunk } from '@src/modules/ingestion/db/claim-chunk.js';
import { releaseChunk } from '@src/modules/ingestion/db/release-chunk.js';
import { ingestionChunks } from '@src/modules/ingestion/db/schema/ingestion-chunks.js';
import { ingestionJobs } from '@src/modules/ingestion/db/schema/ingestion-jobs.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

let sequence = 0;

async function jobWithChunk(): Promise<number> {
  const [job] = await db()
    .insert(ingestionJobs)
    .values({
      vendor: `vendor-${(sequence += 1)}`,
      fileRef: `file-${sequence}.csv`,
      fileSha256: `sha-${sequence}`,
      fileSizeBytes: 1000,
      chunksTotal: 1,
    })
    .returning();
  await db()
    .insert(ingestionChunks)
    .values({ jobId: job!.id, chunkIndex: 0, startOffset: 0, endOffset: 1000, nextOffset: 0 });
  return job!.id;
}

const chunkRow = async (jobId: number) => {
  const [row] = await db()
    .select()
    .from(ingestionChunks)
    .where(and(eq(ingestionChunks.jobId, jobId), eq(ingestionChunks.chunkIndex, 0)));
  return row;
};

describe('releaseChunk', () => {
  it('hands the chunk back so the re-enqueued job can claim it at once', async () => {
    // Without this the invocation that ran out of budget still holds its lease,
    // and the job it just enqueued finds the chunk busy and returns having done
    // nothing — the import would stall for a lease duration per budget window.
    const jobId = await jobWithChunk();
    await claimChunk(db(), jobId, 0, 90_000);

    await releaseChunk(db(), jobId, 0);

    expect(await claimChunk(db(), jobId, 0, 90_000)).not.toBeNull();
  });

  it('leaves the checkpoint where it is, so the next claim resumes there', async () => {
    const jobId = await jobWithChunk();
    await claimChunk(db(), jobId, 0, 90_000);
    await db()
      .update(ingestionChunks)
      .set({ nextOffset: 400, rowsProcessed: 12 })
      .where(eq(ingestionChunks.jobId, jobId));

    await releaseChunk(db(), jobId, 0);

    const row = await chunkRow(jobId);
    expect(row?.nextOffset).toBe(400);
    expect(row?.rowsProcessed).toBe(12);
  });

  it('does not resurrect a chunk that finished', async () => {
    const jobId = await jobWithChunk();
    await db()
      .update(ingestionChunks)
      .set({ status: 'done', nextOffset: 1000 })
      .where(eq(ingestionChunks.jobId, jobId));

    await releaseChunk(db(), jobId, 0);

    expect((await chunkRow(jobId))?.status).toBe('done');
  });
});
