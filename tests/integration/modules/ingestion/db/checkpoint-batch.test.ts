import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { checkpointBatch } from '@src/modules/ingestion/db/checkpoint-batch.js';
import { ingestionChunks } from '@src/modules/ingestion/db/schema/ingestion-chunks.js';
import { ingestionJobs } from '@src/modules/ingestion/db/schema/ingestion-jobs.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

let sequence = 0;

async function chunkAt(nextOffset: number): Promise<number> {
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
    .values({ jobId: job!.id, chunkIndex: 0, startOffset: 0, endOffset: 1000, nextOffset });
  return job!.id;
}

const chunkRow = async (jobId: number) => {
  const [row] = await db()
    .select()
    .from(ingestionChunks)
    .where(and(eq(ingestionChunks.jobId, jobId), eq(ingestionChunks.chunkIndex, 0)));
  return row;
};

describe('checkpointBatch', () => {
  it('advances the offset and adds the batch counts', async () => {
    const jobId = await chunkAt(200);

    const moved = await checkpointBatch(db(), {
      jobId,
      chunkIndex: 0,
      seenOffset: 200,
      nextOffset: 400,
      rowsProcessed: 37,
      rowsRejected: 3,
    });

    expect(moved).toBe(true);
    const row = await chunkRow(jobId);
    expect(row?.nextOffset).toBe(400);
    expect(row?.rowsProcessed).toBe(37);
    expect(row?.rowsRejected).toBe(3);
  });

  it('refuses a checkpoint whose seen offset is stale, and writes nothing', async () => {
    // Two invocations after an expired lease: the loser read 200, the winner has
    // already moved to 400. Without the compare-and-set the loser would rewind the
    // checkpoint and the rows between would be processed twice.
    const jobId = await chunkAt(400);

    const moved = await checkpointBatch(db(), {
      jobId,
      chunkIndex: 0,
      seenOffset: 200,
      nextOffset: 300,
      rowsProcessed: 10,
      rowsRejected: 0,
    });

    expect(moved).toBe(false);
    const row = await chunkRow(jobId);
    expect(row?.nextOffset).toBe(400);
    expect(row?.rowsProcessed).toBe(0);
  });

  it('accumulates counts across batches rather than replacing them', async () => {
    const jobId = await chunkAt(0);

    await checkpointBatch(db(), {
      jobId,
      chunkIndex: 0,
      seenOffset: 0,
      nextOffset: 100,
      rowsProcessed: 10,
      rowsRejected: 1,
    });
    await checkpointBatch(db(), {
      jobId,
      chunkIndex: 0,
      seenOffset: 100,
      nextOffset: 250,
      rowsProcessed: 12,
      rowsRejected: 0,
    });

    const row = await chunkRow(jobId);
    expect(row?.nextOffset).toBe(250);
    expect(row?.rowsProcessed).toBe(22);
    expect(row?.rowsRejected).toBe(1);
  });

  it('lets exactly one of two concurrent checkpoints win from the same seen offset', async () => {
    const jobId = await chunkAt(500);

    const [a, b] = await Promise.all([
      checkpointBatch(db(), {
        jobId,
        chunkIndex: 0,
        seenOffset: 500,
        nextOffset: 600,
        rowsProcessed: 5,
        rowsRejected: 0,
      }),
      checkpointBatch(db(), {
        jobId,
        chunkIndex: 0,
        seenOffset: 500,
        nextOffset: 700,
        rowsProcessed: 9,
        rowsRejected: 0,
      }),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
    const row = await chunkRow(jobId);
    expect([600, 700]).toContain(row?.nextOffset);
    expect([5, 9]).toContain(row?.rowsProcessed);
  });

  it('marks the chunk done when the checkpoint reaches the end of its range', async () => {
    const jobId = await chunkAt(900);

    await checkpointBatch(db(), {
      jobId,
      chunkIndex: 0,
      seenOffset: 900,
      nextOffset: 1000,
      rowsProcessed: 4,
      rowsRejected: 0,
    });

    expect((await chunkRow(jobId))?.status).toBe('done');
  });

  it('leaves a chunk running while bytes remain', async () => {
    const jobId = await chunkAt(0);

    await checkpointBatch(db(), {
      jobId,
      chunkIndex: 0,
      seenOffset: 0,
      nextOffset: 999,
      rowsProcessed: 4,
      rowsRejected: 0,
    });

    expect((await chunkRow(jobId))?.status).not.toBe('done');
  });
});
