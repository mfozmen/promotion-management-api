import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Db } from '../../../shared/db/client.js';
import { chunkBoundaries } from '../domain/chunk-boundaries.js';
import { ingestionChunks } from '../db/schema/ingestion-chunks.js';
import { ingestionJobs } from '../db/schema/ingestion-jobs.js';
import type { ChunkProcess } from '../events/chunk-process.js';

/** What a registration produced, for a caller that wants to report or follow it. */
interface Registration {
  jobId: number;
  chunksTotal: number;
}

/**
 * Turns a vendor file into an import: one job row, one chunk row per byte range,
 * and one `chunk.process` job per chunk.
 *
 * There is no upload endpoint — issue #15 was not planned — so this is reached
 * from `npm run ingest -- <file>` and the file is already on disk.
 */
export class ImportRegistrar {
  private readonly db: Db;
  private readonly enqueue: (chunk: ChunkProcess) => Promise<unknown>;
  private readonly chunkBytes: number;

  constructor(options: {
    db: Db;
    enqueue: (chunk: ChunkProcess) => Promise<unknown>;
    chunkBytes: number;
  }) {
    this.db = options.db;
    this.enqueue = options.enqueue;
    this.chunkBytes = options.chunkBytes;
  }

  async register(vendor: string, path: string): Promise<Registration> {
    const [size, fileSha256, boundaries] = await Promise.all([
      stat(path).then((file) => file.size),
      ImportRegistrar.sha256(path),
      chunkBoundaries(path, this.chunkBytes),
    ]);

    return this.db.transaction(async (tx) => {
      // `file_sha256` is unique, so the same bytes twice fail here rather than in
      // a check-then-insert that two concurrent registrations both pass.
      const [job] = await tx
        .insert(ingestionJobs)
        .values({
          vendor,
          fileRef: path,
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

      // Inside the transaction, so a queue that refuses takes the job rows with
      // it. A job row with no runnable chunks is an import nothing will ever
      // finish, and it holds the one-running-job-per-vendor index against the
      // next attempt. The cost is the other direction: jobs already enqueued when
      // a later one fails are left behind, and they are harmless — a
      // `chunk.process` naming a chunk that no longer exists claims nothing and
      // returns, which is the same path a duplicate delivery takes.
      for (const boundary of boundaries) {
        await this.enqueue({ jobId, chunkIndex: boundary.chunkIndex });
      }

      return { jobId, chunksTotal: boundaries.length };
    });
  }

  /**
   * The hash is streamed rather than read: this runs on the same 256 MiB budget
   * as the worker, and the file it is hashing is the 500 000-row one.
   */
  private static async sha256(path: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const window of createReadStream(path)) hash.update(window as Buffer);
    return hash.digest('hex');
  }
}
