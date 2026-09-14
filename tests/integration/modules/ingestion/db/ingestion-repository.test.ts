import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { IngestionRepository } from '@src/modules/ingestion/db/ingestion-repository.js';
import { ingestionChunks } from '@src/modules/ingestion/db/schema/ingestion-chunks.js';
import { ingestionJobs } from '@src/modules/ingestion/db/schema/ingestion-jobs.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

let sequence = 0;

describe('IngestionRepository: claim chunk', () => {
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

      const claimed = await new IngestionRepository(db()).claimChunk(jobId, 0, 90_000);

      expect(claimed?.nextOffset).toBe(0);
      const row = await chunkRow(jobId);
      expect(row?.status).toBe('running');
      expect(row?.attempts).toBe(1);
      expect(row?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());
    });

    it('refuses a chunk whose lease is still held, so a duplicate job returns at once', async () => {
      // Duplicate `chunk.process` jobs are expected — the spec says extra
      // invocations are harmless — and the lease is what makes that true.
      const jobId = await newJobWithChunk();
      await new IngestionRepository(db()).claimChunk(jobId, 0, 90_000);

      expect(await new IngestionRepository(db()).claimChunk(jobId, 0, 90_000)).toBeNull();
      expect((await chunkRow(jobId))?.attempts).toBe(1);
    });

    it('reclaims a chunk whose lease has expired, because its worker was killed', async () => {
      const jobId = await newJobWithChunk({
        status: 'running',
        leaseUntil: new Date(Date.now() - 1000),
        nextOffset: 400,
        attempts: 1,
      });

      const claimed = await new IngestionRepository(db()).claimChunk(jobId, 0, 90_000);

      expect(claimed?.nextOffset).toBe(400);
      expect((await chunkRow(jobId))?.attempts).toBe(2);
    });

    it('resumes from the checkpoint, not from the start of the range', async () => {
      const jobId = await newJobWithChunk({ nextOffset: 640, startOffset: 0, endOffset: 1000 });

      const claimed = await new IngestionRepository(db()).claimChunk(jobId, 0, 90_000);

      expect(claimed?.nextOffset).toBe(640);
      expect(claimed?.endOffset).toBe(1000);
    });

    it('refuses a chunk already done, so a redelivered job does not redo it', async () => {
      const jobId = await newJobWithChunk({ status: 'done', nextOffset: 1000 });

      expect(await new IngestionRepository(db()).claimChunk(jobId, 0, 90_000)).toBeNull();
    });

    it('lets exactly one of two racing claims win', async () => {
      // Two invocations after an expired lease: the UPDATE is the arbiter, so the
      // loser matches no row and returns rather than processing the same bytes.
      const jobId = await newJobWithChunk({
        status: 'running',
        leaseUntil: new Date(Date.now() - 1000),
      });

      const [a, b] = await Promise.all([
        new IngestionRepository(db()).claimChunk(jobId, 0, 90_000),
        new IngestionRepository(db()).claimChunk(jobId, 0, 90_000),
      ]);

      expect([a, b].filter((c) => c !== null)).toHaveLength(1);
      expect((await chunkRow(jobId))?.attempts).toBe(1);
    });

    it('returns null for a chunk that does not exist', async () => {
      const jobId = await newJobWithChunk();

      expect(await new IngestionRepository(db()).claimChunk(jobId, 99, 90_000)).toBeNull();
    });
  });
});

describe('IngestionRepository: checkpoint batch', () => {
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

      const moved = await new IngestionRepository(db()).checkpointBatch(db(), {
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

      const moved = await new IngestionRepository(db()).checkpointBatch(db(), {
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

      await new IngestionRepository(db()).checkpointBatch(db(), {
        jobId,
        chunkIndex: 0,
        seenOffset: 0,
        nextOffset: 100,
        rowsProcessed: 10,
        rowsRejected: 1,
      });
      await new IngestionRepository(db()).checkpointBatch(db(), {
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
        new IngestionRepository(db()).checkpointBatch(db(), {
          jobId,
          chunkIndex: 0,
          seenOffset: 500,
          nextOffset: 600,
          rowsProcessed: 5,
          rowsRejected: 0,
        }),
        new IngestionRepository(db()).checkpointBatch(db(), {
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

      await new IngestionRepository(db()).checkpointBatch(db(), {
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

      await new IngestionRepository(db()).checkpointBatch(db(), {
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
});

describe('IngestionRepository: release chunk', () => {
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
});

describe('IngestionRepository: complete job if done', () => {
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

      await new IngestionRepository(db()).refreshJobProgress(jobId);

      const job = await jobRow(jobId);
      expect(job?.rowsProcessed).toBe(160);
      expect(job?.rowsRejected).toBe(4);
      // Only the chunk that finished counts as done; the other is still running.
      expect(job?.chunksDone).toBe(1);
    });

    it('does not put older counts back over a job that has finished', async () => {
      // Two workers: a refresh reads its snapshot when it starts and writes when it
      // commits, so one that began before the last chunk landed can commit after
      // the job was completed. Measured on a 500 000-row run with two workers
      // racing — `completed`, `chunks_done = 5`, 497 336 of 500 000 rows.
      const jobId = await jobWith(1);
      await finish(jobId, 0);
      await db()
        .update(ingestionChunks)
        .set({ rowsProcessed: 500 })
        .where(eq(ingestionChunks.jobId, jobId));
      await new IngestionRepository(db()).completeJobIfDone(jobId);

      // A straggler refresh arriving after the finish must change nothing.
      await new IngestionRepository(db()).refreshJobProgress(jobId);

      const job = await jobRow(jobId);
      expect(job?.status).toBe('completed');
      expect(job?.rowsProcessed).toBe(500);
      expect(job?.chunksDone).toBe(1);
    });

    it('counts nothing for a job whose chunks have not started', async () => {
      const jobId = await jobWith(2);

      await new IngestionRepository(db()).refreshJobProgress(jobId);

      const job = await jobRow(jobId);
      expect({ done: job?.chunksDone, rows: job?.rowsProcessed }).toEqual({ done: 0, rows: 0 });
    });
  });

  describe('completeJobIfDone', () => {
    it('completes the job once its last chunk is done', async () => {
      const jobId = await jobWith(2);
      await finish(jobId, 0);
      await finish(jobId, 1);

      expect(await new IngestionRepository(db()).completeJobIfDone(jobId)).toBe(true);
      const job = await jobRow(jobId);
      expect(job?.status).toBe('completed');
      // Final counters come from the statement that completes it, so a completed
      // job never reports fewer rows than its chunks hold.
      expect(job?.chunksDone).toBe(2);
    });

    it('leaves a job running while any chunk is not done', async () => {
      const jobId = await jobWith(2);
      await finish(jobId, 0);

      expect(await new IngestionRepository(db()).completeJobIfDone(jobId)).toBe(false);
      expect((await jobRow(jobId))?.status).toBe('running');
    });

    it('completes exactly once when the last two chunks finish together', async () => {
      // Every chunk calls this as it lands, so the last two race. Completion is a
      // transition and not a repeated write: the second caller must see false, or
      // an announcement hung off it would go out twice.
      const jobId = await jobWith(1);
      await finish(jobId, 0);

      const [first, second] = await Promise.all([
        new IngestionRepository(db()).completeJobIfDone(jobId),
        new IngestionRepository(db()).completeJobIfDone(jobId),
      ]);

      expect([first, second].filter(Boolean)).toHaveLength(1);
    });

    it('does not reopen a job that already failed', async () => {
      const jobId = await jobWith(1);
      await finish(jobId, 0);
      await db().update(ingestionJobs).set({ status: 'failed' }).where(eq(ingestionJobs.id, jobId));

      expect(await new IngestionRepository(db()).completeJobIfDone(jobId)).toBe(false);
      expect((await jobRow(jobId))?.status).toBe('failed');
    });
  });
});
