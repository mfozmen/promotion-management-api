import { eq } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { ingestionJobs } from '../db/schema/ingestion-jobs.js';

/** What an import has done so far, for whoever is following it. */
export interface ImportStatus {
  id: number;
  vendor: string;
  status: string;
  chunksTotal: number;
  chunksDone: number;
  rowsProcessed: number;
  rowsRejected: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ImportStatusQuery {
  constructor(private readonly db: Db) {}

  /** The counters come from the job row, which each finished chunk rolls up. */
  async byId(id: number): Promise<ImportStatus | undefined> {
    const [job] = await this.db
      .select({
        id: ingestionJobs.id,
        vendor: ingestionJobs.vendor,
        status: ingestionJobs.status,
        chunksTotal: ingestionJobs.chunksTotal,
        chunksDone: ingestionJobs.chunksDone,
        rowsProcessed: ingestionJobs.rowsProcessed,
        rowsRejected: ingestionJobs.rowsRejected,
        lastError: ingestionJobs.lastError,
        createdAt: ingestionJobs.createdAt,
        updatedAt: ingestionJobs.updatedAt,
      })
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, id));

    return job;
  }
}
