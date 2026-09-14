import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { OrphanChunkRepository } from '@src/modules/reconciler/db/orphan-chunk-repository.js';
import { ingestionChunks } from '@src/modules/ingestion/db/schema/ingestion-chunks.js';
import { ingestionJobs } from '@src/modules/ingestion/db/schema/ingestion-jobs.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

let sequence = 0;

async function job(
  chunks: Partial<typeof ingestionChunks.$inferInsert>[],
  status: 'running' | 'completed' | 'failed' = 'running',
): Promise<number> {
  const [inserted] = await db()
    .insert(ingestionJobs)
    .values({
      vendor: `vendor-${(sequence += 1)}`,
      fileRef: `file-${sequence}.csv`,
      fileSha256: `sha-${sequence}`,
      fileSizeBytes: 1000,
      chunksTotal: chunks.length,
      status,
    })
    .returning({ id: ingestionJobs.id });

  await db()
    .insert(ingestionChunks)
    .values(
      chunks.map((chunk, chunkIndex) => ({
        jobId: inserted!.id,
        chunkIndex,
        startOffset: 0,
        endOffset: 1000,
        nextOffset: 0,
        ...chunk,
      })),
    );

  return inserted!.id;
}

const expired = new Date(Date.now() - 3_600_000);
const held = new Date(Date.now() + 3_600_000);

describe('OrphanChunkRepository', () => {
  it('finds the chunks of a running import that no worker holds', async () => {
    const abandoned = await job([
      { status: 'running', leaseUntil: expired },
      { status: 'pending' },
      { status: 'running', leaseUntil: held },
      { status: 'done' },
    ]);

    const orphans = await new OrphanChunkRepository(db()).orphaned();

    // The shape `claimChunk` accepts, and nothing else: a chunk someone is
    // holding right now is not abandoned, and a finished one has no work left.
    expect(orphans.filter((o) => o.jobId === abandoned)).toEqual([
      { jobId: abandoned, chunkIndex: 0 },
      { jobId: abandoned, chunkIndex: 1 },
    ]);
  });

  it('leaves a job that is not running alone, however its chunks look', async () => {
    const finished = await job([{ status: 'running', leaseUntil: expired }], 'failed');

    const orphans = await new OrphanChunkRepository(db()).orphaned();

    expect(orphans.filter((o) => o.jobId === finished)).toEqual([]);
  });

  it('settles a job whose chunks all finished, which is what frees the vendor', async () => {
    const stranded = await job([
      { status: 'done', rowsProcessed: 400, rowsRejected: 1 },
      { status: 'done', rowsProcessed: 600, rowsRejected: 0 },
    ]);

    await expect(new OrphanChunkRepository(db()).settleFinishedJobs()).resolves.toContain(stranded);

    const [row] = await db().select().from(ingestionJobs).where(eq(ingestionJobs.id, stranded));
    // The counters are read in the statement that settles it, so a worker that
    // died before its last refresh does not leave them short.
    expect(row).toMatchObject({
      status: 'completed',
      chunksDone: 2,
      rowsProcessed: 1000,
      rowsRejected: 1,
    });
  });

  it('leaves a job alone while any chunk is unfinished', async () => {
    const working = await job([{ status: 'done' }, { status: 'running', leaseUntil: held }]);

    await expect(new OrphanChunkRepository(db()).settleFinishedJobs()).resolves.not.toContain(
      working,
    );
  });
});
