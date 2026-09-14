import { sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';

/** The chunks of a still-running import that no worker holds. Both a chunk that
 *  was never started and one whose holder died look the same in the table, so
 *  the grace window is what separates "abandoned" from "queued a moment ago":
 *  a lease is only stale once it has been expired for longer than a lease, and
 *  a job is only a candidate once it has gone that long without progress. */
export class OrphanChunkRepository {
  /** A run repairs at most this many chunks, so one enormous backlog cannot
   *  hold the five-minute tick; the next run takes the rest. */
  static readonly LIMIT = 1_000;

  constructor(private readonly db: Db) {}

  /** Exactly the shape `IngestionRepository.claimChunk` accepts, so a chunk this
   *  returns is one a worker can take. */
  async orphaned(graceMs: number): Promise<{ jobId: number; chunkIndex: number }[]> {
    const grace = sql`make_interval(secs => ${graceMs / 1000})`;
    const { rows } = await this.db.execute<
      Record<string, unknown> & { job_id: number; chunk_index: number }
    >(sql`
      select c.job_id, c.chunk_index
      from ingestion_chunks c
      join ingestion_jobs j on j.id = c.job_id
      where j.status = 'running'
        and j.updated_at < now() - ${grace}
        and (c.status = 'pending'
             or (c.status = 'running'
                 and (c.lease_until is null or c.lease_until < now() - ${grace})))
      order by c.job_id, c.chunk_index
      limit ${OrphanChunkRepository.LIMIT}
    `);

    return rows.map((row) => ({ jobId: Number(row.job_id), chunkIndex: Number(row.chunk_index) }));
  }

  /** Every job still running, so the caller can ask the ingestion module to
   *  settle the ones whose chunks all finished. */
  async runningJobIds(): Promise<number[]> {
    const { rows } = await this.db.execute<Record<string, unknown> & { id: number }>(
      sql`select id from ingestion_jobs where status = 'running' order by id`,
    );

    return rows.map((row) => Number(row.id));
  }
}
