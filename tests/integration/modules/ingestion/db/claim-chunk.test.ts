import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { claimChunk } from '@src/modules/ingestion/db/claim-chunk.js';
import { ingestionChunks } from '@src/modules/ingestion/db/schema/ingestion-chunks.js';
import { ingestionJobs } from '@src/modules/ingestion/db/schema/ingestion-jobs.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

let sequence = 0;

async function newJobWithChunk(overrides: Partial<typeof ingestionChunks.$inferInsert> = {}) {
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
    .values({
      jobId: job!.id,
      chunkIndex: 0,
      startOffset: 0,
      endOffset: 1000,
      nextOffset: 0,
      ...overrides,
    });
  return job!.id;
}

const chunkRow = async (jobId: number) => {
  const [row] = await db()
    .select()
    .from(ingestionChunks)
    .where(and(eq(ingestionChunks.jobId, jobId), eq(ingestionChunks.chunkIndex, 0)));
  return row;
};

describe('claimChunk', () => {
  it('claims a pending chunk, takes a lease and counts the attempt', async () => {
    const jobId = await newJobWithChunk();

    const claimed = await claimChunk(db(), jobId, 0, 90_000);

    expect(claimed?.nextOffset).toBe(0);
    const row = await chunkRow(jobId);
    expect(row?.status).toBe('running');
    expect(row?.attempts).toBe(1);
    expect(row?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses a chunk whose lease is still held, so a duplicate job returns at once', async () => {
    // Duplicate `ingestion.chunk` jobs are expected — the spec says extra
    // invocations are harmless — and the lease is what makes that true.
    const jobId = await newJobWithChunk();
    await claimChunk(db(), jobId, 0, 90_000);

    expect(await claimChunk(db(), jobId, 0, 90_000)).toBeNull();
    expect((await chunkRow(jobId))?.attempts).toBe(1);
  });

  it('reclaims a chunk whose lease has expired, because its worker was killed', async () => {
    const jobId = await newJobWithChunk({
      status: 'running',
      leaseUntil: new Date(Date.now() - 1000),
      nextOffset: 400,
      attempts: 1,
    });

    const claimed = await claimChunk(db(), jobId, 0, 90_000);

    expect(claimed?.nextOffset).toBe(400);
    expect((await chunkRow(jobId))?.attempts).toBe(2);
  });

  it('resumes from the checkpoint, not from the start of the range', async () => {
    const jobId = await newJobWithChunk({ nextOffset: 640, startOffset: 0, endOffset: 1000 });

    const claimed = await claimChunk(db(), jobId, 0, 90_000);

    expect(claimed?.nextOffset).toBe(640);
    expect(claimed?.endOffset).toBe(1000);
  });

  it('refuses a chunk already done, so a redelivered job does not redo it', async () => {
    const jobId = await newJobWithChunk({ status: 'done', nextOffset: 1000 });

    expect(await claimChunk(db(), jobId, 0, 90_000)).toBeNull();
  });

  it('lets exactly one of two racing claims win', async () => {
    // Two invocations after an expired lease: the UPDATE is the arbiter, so the
    // loser matches no row and returns rather than processing the same bytes.
    const jobId = await newJobWithChunk({
      status: 'running',
      leaseUntil: new Date(Date.now() - 1000),
    });

    const [a, b] = await Promise.all([
      claimChunk(db(), jobId, 0, 90_000),
      claimChunk(db(), jobId, 0, 90_000),
    ]);

    expect([a, b].filter((c) => c !== null)).toHaveLength(1);
    expect((await chunkRow(jobId))?.attempts).toBe(1);
  });

  it('returns null for a chunk that does not exist', async () => {
    const jobId = await newJobWithChunk();

    expect(await claimChunk(db(), jobId, 99, 90_000)).toBeNull();
  });
});
