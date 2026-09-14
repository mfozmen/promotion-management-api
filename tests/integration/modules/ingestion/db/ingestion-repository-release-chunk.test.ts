import { IngestionRepository } from '@src/modules/ingestion/db/ingestion-repository.js';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
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
    const claimed = await new IngestionRepository(db()).claimChunk(jobId, 0, 90_000);

    await new IngestionRepository(db()).releaseChunk(jobId, 0, claimed!.leaseUntil);

    expect(await new IngestionRepository(db()).claimChunk(jobId, 0, 90_000)).not.toBeNull();
  });

  it('leaves the checkpoint where it is, so the next claim resumes there', async () => {
    const jobId = await jobWithChunk();
    const claimed = await new IngestionRepository(db()).claimChunk(jobId, 0, 90_000);
    await db()
      .update(ingestionChunks)
      .set({ nextOffset: 400, rowsProcessed: 12 })
      .where(eq(ingestionChunks.jobId, jobId));

    await new IngestionRepository(db()).releaseChunk(jobId, 0, claimed!.leaseUntil);

    const row = await chunkRow(jobId);
    expect(row?.nextOffset).toBe(400);
    expect(row?.rowsProcessed).toBe(12);
  });

  it('does not release a lease another invocation holds', async () => {
    // The invocation that ran over its lease is not the holder any more. Its own
    // batch can still commit — the winner has not moved `next_offset` yet — and it
    // then reaches the budget hand-off and releases a chunk somebody else is
    // working. Releasing is giving back what you hold, and holding has to be
    // proved rather than assumed from the status.
    const jobId = await jobWithChunk();
    const overrun = await new IngestionRepository(db()).claimChunk(jobId, 0, 1);
    await db()
      .update(ingestionChunks)
      .set({ leaseUntil: sql`now() - interval '1 second'` })
      .where(eq(ingestionChunks.jobId, jobId));
    const holder = await new IngestionRepository(db()).claimChunk(jobId, 0, 90_000);

    await new IngestionRepository(db()).releaseChunk(jobId, 0, overrun!.leaseUntil);

    const row = await chunkRow(jobId);
    expect(row?.status).toBe('running');
    expect(row?.leaseUntil?.getTime()).toBe(holder!.leaseUntil?.getTime());
  });

  it('releases when the caller is the holder', async () => {
    const jobId = await jobWithChunk();
    const claimed = await new IngestionRepository(db()).claimChunk(jobId, 0, 90_000);

    await new IngestionRepository(db()).releaseChunk(jobId, 0, claimed!.leaseUntil);

    expect((await chunkRow(jobId))?.status).toBe('pending');
  });

  it('does not resurrect a chunk that finished', async () => {
    const jobId = await jobWithChunk();
    await db()
      .update(ingestionChunks)
      .set({ status: 'done', nextOffset: 1000, leaseUntil: sql`now() + interval '1 minute'` })
      .where(eq(ingestionChunks.jobId, jobId));
    const [held] = await db()
      .select({ leaseUntil: ingestionChunks.leaseUntil })
      .from(ingestionChunks)
      .where(eq(ingestionChunks.jobId, jobId));

    await new IngestionRepository(db()).releaseChunk(jobId, 0, held!.leaseUntil!);

    expect((await chunkRow(jobId))?.status).toBe('done');
  });
});
