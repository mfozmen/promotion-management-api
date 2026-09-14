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

const GRACE_MS = 90_000;
/** The grace window measures from the job's own progress, so a fixture has to
 *  look like it has been sitting rather than like it was just registered. */
async function aged(id: number): Promise<number> {
  await db()
    .update(ingestionJobs)
    .set({ updatedAt: new Date(Date.now() - 3_600_000) })
    .where(eq(ingestionJobs.id, id));

  return id;
}

const expired = new Date(Date.now() - 3_600_000);
const held = new Date(Date.now() + 3_600_000);

describe('OrphanChunkRepository', () => {
  it('finds the chunks of a running import that no worker holds', async () => {
    const abandoned = await aged(
      await job([
        { status: 'running', leaseUntil: expired },
        { status: 'pending' },
        { status: 'running', leaseUntil: held },
        { status: 'done' },
      ]),
    );

    const orphans = await new OrphanChunkRepository(db()).orphaned(GRACE_MS);

    // The shape `claimChunk` accepts, and nothing else: a chunk someone is
    // holding right now is not abandoned, and a finished one has no work left.
    expect(orphans.filter((o) => o.jobId === abandoned)).toEqual([
      { jobId: abandoned, chunkIndex: 0 },
      { jobId: abandoned, chunkIndex: 1 },
    ]);
  });

  it('leaves a job that is not running alone, however its chunks look', async () => {
    const finished = await aged(await job([{ status: 'running', leaseUntil: expired }], 'failed'));

    const orphans = await new OrphanChunkRepository(db()).orphaned(GRACE_MS);

    expect(orphans.filter((o) => o.jobId === finished)).toEqual([]);
  });

  it('lists the jobs still running, so the caller can settle the finished ones', async () => {
    const stranded = await job([{ status: 'done' }, { status: 'done' }]);
    const finished = await job([{ status: 'done' }], 'completed');

    const running = await new OrphanChunkRepository(db()).runningJobIds();

    expect(running).toContain(stranded);
    expect(running).not.toContain(finished);
  });

  it('leaves a young job alone, because a queued chunk looks exactly like an abandoned one', async () => {
    const justRegistered = await job([{ status: 'pending' }]);

    const orphans = await new OrphanChunkRepository(db()).orphaned(GRACE_MS);

    // Registration enqueued it seconds ago; without the grace window every
    // healthy import is swept on its first tick.
    expect(orphans.filter((o) => o.jobId === justRegistered)).toEqual([]);
  });
});
