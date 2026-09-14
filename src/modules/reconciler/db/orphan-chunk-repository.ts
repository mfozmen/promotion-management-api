import { sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';

/** The chunks of a still-running import that no worker holds, and the jobs whose
 *  work is finished but whose status never moved. Both keep a vendor locked out
 *  of importing (issue #134). */
export class OrphanChunkRepository {
  constructor(private readonly db: Db) {}

  /** Exactly the shape `IngestionRepository.claimChunk` will accept, so a job
   *  this returns is one a worker can take. */
  async orphaned(): Promise<{ jobId: number; chunkIndex: number }[]> {
    const { rows } = await this.db.execute<
      Record<string, unknown> & { job_id: number; chunk_index: number }
    >(sql`
      select c.job_id, c.chunk_index
      from ingestion_chunks c
      join ingestion_jobs j on j.id = c.job_id
      where j.status = 'running'
        and (c.status = 'pending'
             or (c.status = 'running' and (c.lease_until is null or c.lease_until < now())))
      order by c.job_id, c.chunk_index
    `);

    return rows.map((row) => ({ jobId: Number(row.job_id), chunkIndex: Number(row.chunk_index) }));
  }

  /** A worker that died between its last checkpoint and `completeJobIfDone`
   *  leaves a job running with nothing left to do. The counters are read in the
   *  statement that settles it, so they are final by construction. */
  async settleFinishedJobs(): Promise<number[]> {
    const { rows } = await this.db.execute<Record<string, unknown> & { id: number }>(sql`
      update ingestion_jobs j
      set status = 'completed',
          chunks_done = (select count(*) from ingestion_chunks c
                         where c.job_id = j.id and c.status = 'done'),
          rows_processed = (select coalesce(sum(c.rows_processed), 0) from ingestion_chunks c
                            where c.job_id = j.id),
          rows_rejected = (select coalesce(sum(c.rows_rejected), 0) from ingestion_chunks c
                           where c.job_id = j.id),
          updated_at = now()
      where j.status = 'running'
        and not exists (select 1 from ingestion_chunks c
                        where c.job_id = j.id and c.status <> 'done')
      returning j.id
    `);

    return rows.map((row) => Number(row.id));
  }
}
