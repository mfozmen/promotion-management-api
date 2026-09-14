import { and, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Db, Queryable } from '../../../shared/db/client.js';
import type { BatchCheckpoint } from '../domain/dto/batch-checkpoint.js';
import type { ClaimedChunk } from '../domain/dto/claimed-chunk.js';
import { ingestionChunks } from './schema/ingestion-chunks.js';
import { ingestionJobs } from './schema/ingestion-jobs.js';

/**
 * Every query the ingestion module makes against its own tables.
 *
 * A method taking a `Queryable` joins the caller's transaction rather than
 * opening its own: `checkpointBatch` commits with the product write it belongs to.
 */
export class IngestionRepository {
  constructor(private readonly db: Db) {}

  /** One guarded `UPDATE` is the arbiter: two invocations race it and one matches a row. */
  async claimChunk(
    jobId: number,
    chunkIndex: number,
    leaseMs: number,
  ): Promise<ClaimedChunk | null> {
    const [claimed] = await this.db
      .update(ingestionChunks)
      .set({
        status: 'running',
        // Truncated because the lease doubles as the holder's proof and a JavaScript
        // `Date` cannot hold PostgreSQL's microseconds: untruncated, it comes back
        // rounded and the real holder fails to prove it is the holder.
        leaseUntil: sql`date_trunc('milliseconds', now() + make_interval(secs => ${leaseMs / 1000}))`,
        attempts: sql`${ingestionChunks.attempts} + 1`,
      })
      .where(
        and(
          eq(ingestionChunks.jobId, jobId),
          eq(ingestionChunks.chunkIndex, chunkIndex),
          or(
            eq(ingestionChunks.status, 'pending'),
            and(
              eq(ingestionChunks.status, 'running'),
              or(isNull(ingestionChunks.leaseUntil), lt(ingestionChunks.leaseUntil, sql`now()`)),
            ),
          ),
        ),
      )
      .returning({
        jobId: ingestionChunks.jobId,
        chunkIndex: ingestionChunks.chunkIndex,
        startOffset: ingestionChunks.startOffset,
        endOffset: ingestionChunks.endOffset,
        nextOffset: ingestionChunks.nextOffset,
        leaseUntil: ingestionChunks.leaseUntil,
        attempts: ingestionChunks.attempts,
        failures: ingestionChunks.failures,
      });

    if (claimed === undefined) return null;
    // The `SET` above writes a lease on every claim, so the column is non-null here
    // even though it is nullable in the table — a chunk that has never been claimed
    // has no lease. Narrowing it at the boundary keeps the holder's proof a `Date`
    // rather than something every caller has to re-check.
    return { ...claimed, leaseUntil: claimed.leaseUntil as Date };
  }
  /** Compare-and-set on `next_offset`: the loser writes nothing and says so. */
  async checkpointBatch(db: Queryable, batch: BatchCheckpoint): Promise<boolean> {
    const moved = await db
      .update(ingestionChunks)
      .set({
        nextOffset: batch.nextOffset,
        rowsProcessed: sql`${ingestionChunks.rowsProcessed} + ${batch.rowsProcessed}`,
        rowsRejected: sql`${ingestionChunks.rowsRejected} + ${batch.rowsRejected}`,
        status: sql`case when ${batch.nextOffset} >= ${ingestionChunks.endOffset} then 'done'::chunk_status else ${ingestionChunks.status} end`,
      })
      .where(
        and(
          eq(ingestionChunks.jobId, batch.jobId),
          eq(ingestionChunks.chunkIndex, batch.chunkIndex),
          eq(ingestionChunks.nextOffset, batch.seenOffset),
        ),
      )
      .returning({ chunkIndex: ingestionChunks.chunkIndex });

    return moved.length === 1;
  }
  /** Releasing is giving back what you hold, so the lease is checked, not just the status. */
  async releaseChunk(jobId: number, chunkIndex: number, leaseUntil: Date): Promise<void> {
    await this.db
      .update(ingestionChunks)
      .set({ status: 'pending', leaseUntil: sql`null` })
      .where(
        and(
          eq(ingestionChunks.jobId, jobId),
          eq(ingestionChunks.chunkIndex, chunkIndex),
          eq(ingestionChunks.status, 'running'),
          eq(ingestionChunks.leaseUntil, leaseUntil),
        ),
      );
  }
  /** `status = 'running'` stops a refresh that began earlier committing over the finish. */
  async refreshJobProgress(jobId: number): Promise<void> {
    await this.db
      .update(ingestionJobs)
      .set({
        chunksDone: sql`(select count(*) from ${ingestionChunks}
          where ${ingestionChunks.jobId} = ${jobId} and ${ingestionChunks.status} = 'done')`,
        rowsProcessed: sql`(select coalesce(sum(${ingestionChunks.rowsProcessed}), 0)
          from ${ingestionChunks} where ${ingestionChunks.jobId} = ${jobId})`,
        rowsRejected: sql`(select coalesce(sum(${ingestionChunks.rowsRejected}), 0)
          from ${ingestionChunks} where ${ingestionChunks.jobId} = ${jobId})`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(ingestionJobs.id, jobId), eq(ingestionJobs.status, 'running')));
  }
  /** A failed attempt is recorded on the chunk and on its job, and a chunk that
   *  has spent its attempts becomes `failed` — the terminal status that takes it
   *  out of the reconciler's reach, so a chunk that can never succeed stops
   *  being retried every five minutes. */
  async recordChunkFailure(
    jobId: number,
    chunkIndex: number,
    reason: string,
    maxFailures: number,
  ): Promise<{ failures: number; exhausted: boolean }> {
    const [chunk] = await this.db
      .update(ingestionChunks)
      .set({
        failures: sql`${ingestionChunks.failures} + 1`,
        lastError: reason.slice(0, 1_000),
        status: sql`case when ${ingestionChunks.failures} + 1 >= ${maxFailures}
          then 'failed'::chunk_status else ${ingestionChunks.status} end`,
      })
      .where(and(eq(ingestionChunks.jobId, jobId), eq(ingestionChunks.chunkIndex, chunkIndex)))
      .returning({ failures: ingestionChunks.failures, status: ingestionChunks.status });

    await this.db
      .update(ingestionJobs)
      .set({ lastError: reason.slice(0, 1_000), updatedAt: sql`now()` })
      .where(eq(ingestionJobs.id, jobId));

    return { failures: chunk?.failures ?? 0, exhausted: chunk?.status === 'failed' };
  }

  /** A job with no chunk left to run and at least one that gave up is `failed`,
   *  which is what releases the vendor from the one-running-import index. */
  async failJobIfExhausted(jobId: number): Promise<boolean> {
    const failed = await this.db
      .update(ingestionJobs)
      .set({
        status: 'failed',
        chunksDone: sql`(select count(*) from ${ingestionChunks}
          where ${ingestionChunks.jobId} = ${jobId} and ${ingestionChunks.status} = 'done')`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(ingestionJobs.id, jobId),
          eq(ingestionJobs.status, 'running'),
          sql`not exists (
            select 1 from ${ingestionChunks}
            where ${ingestionChunks.jobId} = ${jobId}
              and ${ingestionChunks.status} not in ('done', 'failed')
          )`,
          sql`exists (
            select 1 from ${ingestionChunks}
            where ${ingestionChunks.jobId} = ${jobId}
              and ${ingestionChunks.status} = 'failed'
          )`,
        ),
      )
      .returning({ id: ingestionJobs.id });

    return failed.length === 1;
  }

  /** The counters go in the statement that completes the job, so they are final by construction. */
  async completeJobIfDone(jobId: number): Promise<boolean> {
    const completed = await this.db
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
  async findIngestionJob(id: number): Promise<{ id: number; fileRef: string } | undefined> {
    const [job] = await this.db
      .select({ id: ingestionJobs.id, fileRef: ingestionJobs.fileRef })
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, id));
    return job;
  }
}
