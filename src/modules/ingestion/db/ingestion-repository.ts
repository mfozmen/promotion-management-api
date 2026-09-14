import { and, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Db, Queryable } from '../../../shared/db/client.js';
import type { BatchCheckpoint } from '../domain/dto/batch-checkpoint.js';
import type { ClaimedChunk } from '../domain/dto/claimed-chunk.js';
import { ingestionChunks } from './schema/ingestion-chunks.js';
import { ingestionJobs } from './schema/ingestion-jobs.js';

/**
 * Every query the ingestion module makes against its own tables.
 *
 * The methods that take a `Queryable` do so because their caller owns the
 * transaction: `checkpointBatch` commits with the product write it belongs to,
 * and a repository that opened its own would break the guarantee the caller is
 * making. The rest use the handle this was built with.
 */
export class IngestionRepository {
  constructor(private readonly db: Db) {}

  /**
   * Takes a chunk for this invocation, or returns null because someone else holds it.
   *
   * One guarded `UPDATE` is the whole mechanism: the `WHERE` admits a chunk that is
   * pending, or one whose lease has expired because its worker was killed, and the
   * statement that decides is the statement that writes. Two invocations racing an
   * expired lease both run it and exactly one matches a row (REVIEW.md 3.1).
   *
   * Duplicate `chunk.process` jobs are expected rather than exceptional — the
   * registration step enqueues one per chunk and a redelivery costs nothing — so
   * the null return is the ordinary path, not an error.
   *
   * `next_offset` comes back rather than `start_offset`: a reclaimed chunk resumes
   * at its last committed batch, which is what makes a kill mid-file cost one batch
   * instead of the whole chunk.
   *
   * `lease_until` comes back as the holder's proof. There is no separate token: the
   * lease this statement wrote is unique to this claim because `now()` advances, and
   * an invocation that cannot show it is not the holder any more.
   */
  async claimChunk(
    jobId: number,
    chunkIndex: number,
    leaseMs: number,
  ): Promise<ClaimedChunk | null> {
    const [claimed] = await this.db
      .update(ingestionChunks)
      .set({
        status: 'running',
        // Truncated to milliseconds because the lease doubles as the holder's proof
        // and JavaScript's Date cannot hold PostgreSQL's microseconds: an untruncated
        // lease comes back rounded, never equals the stored value, and the holder
        // fails to prove it is the holder.
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
  /**
   * Moves the checkpoint forward, but only from the offset the caller read.
   *
   * `where next_offset = $seen` is the compare-and-set the whole resume story rests
   * on. Two invocations can hold a chunk at once — an expired lease is a guess, not
   * a fact — and without this the loser would rewind the checkpoint and every row
   * between the two offsets would be processed a second time. The upsert makes that
   * invisible in the catalogue, which is why the guard is here rather than trusted
   * to the lease.
   *
   * Returning `false` is an ordinary outcome: the caller rolls back its batch and
   * returns, because someone else owns the chunk now.
   *
   * The counts are added rather than assigned, so `rows_processed` is exact across
   * a chunk that took several invocations to finish.
   */
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
  /**
   * Hands a chunk back before its lease would have expired, for an invocation that
   * ran out of time budget rather than out of rows.
   *
   * Without it the invocation that stopped still holds the lease, and the
   * `chunk.process` job it just enqueued finds the chunk busy and returns having
   * done nothing — the import would stall for a lease duration on every budget
   * window instead of continuing in the next one.
   *
   * `status = 'running'` in the `WHERE` keeps it from resurrecting a chunk that
   * finished, and `lease_until` keeps it from releasing one somebody else holds.
   * Both matter: an invocation that ran past its lease inside a single batch is no
   * longer the holder, and its own batch can still commit — the winner has not moved
   * `next_offset` yet — so it reaches this hand-off and would hand back a chunk
   * another invocation is working. Releasing is giving back what you hold, and
   * holding is proved rather than assumed from the status.
   */
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
  /**
   * Carries the chunk counters up to the job that owns them.
   *
   * The counts live on `ingestion_chunks`, because that is where the checkpoint
   * that earns them commits. Nothing carried them to `ingestion_jobs`, so the one
   * row an operator reads answered `chunks_done = 0, rows_processed = 0` while the
   * job said `completed` — measured on a real 500 000-row import whose six chunks
   * held exactly 500 000 rows between them.
   *
   * Recomputed from the chunks rather than incremented, so it is idempotent: a
   * chunk replayed after a kill, or two invocations calling this at once, cannot
   * double-count. The cost is an aggregate over one job's chunks, which is a
   * handful of rows, and it is paid once per finished chunk rather than per batch.
   *
   * `status = 'running'` is what keeps progress from overwriting the finish. Under
   * two workers the statement reads its snapshot when it starts and writes when it
   * commits, so a refresh that began before the last chunk landed can commit after
   * the job was completed and put the older counts back. Measured: a 500 000-row
   * run ending `completed` with `chunks_done = 5` and 497 336 rows while its six
   * chunks held 500 000 between them.
   */
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
  /**
   * Reads the job a chunk belongs to, for the file its rows are in.
   *
   * The `chunk.process` payload carries ids and not a path: a queued job outlives
   * the request that made it, and a path in the payload would be a second copy of
   * something the row already holds.
   */
  async findIngestionJob(id: number): Promise<{ id: number; fileRef: string } | undefined> {
    const [job] = await this.db
      .select({ id: ingestionJobs.id, fileRef: ingestionJobs.fileRef })
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, id));
    return job;
  }
}
