import { eq } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { ingestionJobs } from './schema/ingestion-jobs.js';

/**
 * Reads the job a chunk belongs to, for the file its rows are in.
 *
 * The `chunk.process` payload carries ids and not a path: a queued job outlives
 * the request that made it, and a path in the payload would be a second copy of
 * something the row already holds.
 */
export async function findIngestionJob(
  db: Db,
  id: number,
): Promise<{ id: number; fileRef: string } | undefined> {
  const [job] = await db
    .select({ id: ingestionJobs.id, fileRef: ingestionJobs.fileRef })
    .from(ingestionJobs)
    .where(eq(ingestionJobs.id, id));
  return job;
}
