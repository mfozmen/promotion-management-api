import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '../../../shared/db/client.js';
import { chunkBoundaries } from '../domain/chunk-boundaries.js';
import { ingestionChunks } from '../db/schema/ingestion-chunks.js';
import { ingestionJobs } from '../db/schema/ingestion-jobs.js';
import type { ChunkProcess } from '../events/chunk-process.js';
import type { ImportRegistrationOutcome } from '../domain/dto/import-registration-outcome.js';
import { hasSqlState } from '../../../shared/db/has-sql-state.js';
import { SqlState } from '../../../shared/db/sql-state.js';

/** A vendor file becomes one job row, one chunk row per byte range, one job per chunk. */
export class RegisterImportCommand {
  private readonly db: Db;
  private readonly enqueue: (chunk: ChunkProcess) => Promise<unknown>;
  private readonly chunkBytes: number;
  private readonly uploadDir: string;

  constructor(options: {
    db: Db;
    enqueue: (chunk: ChunkProcess) => Promise<unknown>;
    chunkBytes: number;
    /** Where vendor files live for this process; the container's is not the host's. */
    uploadDir: string;
  }) {
    this.db = options.db;
    this.enqueue = options.enqueue;
    this.chunkBytes = options.chunkBytes;
    this.uploadDir = options.uploadDir;
  }

  /** `fileRef` names a file in the upload directory; the worker resolves it against its own. */
  async execute(vendor: string, fileRef: string): Promise<ImportRegistrationOutcome> {
    const path = join(this.uploadDir, fileRef);
    const [size, fileSha256, boundaries] = await Promise.all([
      stat(path).then((file) => file.size),
      RegisterImportCommand.sha256(path),
      chunkBoundaries(path, this.chunkBytes),
    ]);

    let registered;
    try {
      registered = await this.db.transaction(async (tx) => {
        // Unique `file_sha256`: a check-then-insert lets two concurrent registrations both pass.
        const [job] = await tx
          .insert(ingestionJobs)
          .values({
            vendor,
            fileRef,
            fileSha256,
            fileSizeBytes: size,
            chunksTotal: boundaries.length,
          })
          .returning({ id: ingestionJobs.id });
        const jobId = job!.id;

        if (boundaries.length > 0) {
          await tx.insert(ingestionChunks).values(
            boundaries.map((boundary) => ({
              jobId,
              chunkIndex: boundary.chunkIndex,
              startOffset: boundary.startOffset,
              endOffset: boundary.endOffset,
              nextOffset: boundary.startOffset,
            })),
          );
        }

        return { jobId, boundaries };
      });
    } catch (error) {
      // Which of the two unique indexes refused it decides the caller's fix.
      if (!hasSqlState(error, SqlState.uniqueViolation)) throw error;

      return { ok: false, reason: busyVendor(error) ? 'vendor-busy' : 'duplicate-file' };
    }

    // After the commit: enqueued first, a worker claims a chunk whose row is not there yet.
    for (const boundary of registered.boundaries) {
      await this.enqueue({ jobId: registered.jobId, chunkIndex: boundary.chunkIndex });
    }

    return { ok: true, jobId: registered.jobId, chunksTotal: registered.boundaries.length };
  }

  /** Streamed, not read: the same 256 MiB budget, and this is the 500 000-row file. */
  private static async sha256(path: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const window of createReadStream(path)) hash.update(window as Buffer);
    return hash.digest('hex');
  }
}

/** The constraint sits on a cause rather than on what was thrown. */
function busyVendor(error: unknown): boolean {
  for (let at: unknown = error; at instanceof Error; at = at.cause) {
    if ('constraint' in at && at.constraint === 'ingestion_jobs_one_running_per_vendor')
      return true;
  }

  return false;
}
