import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
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

  /**
   * `fileRef` is a name inside the upload directory, never a path: the worker runs
   * in a different filesystem and a stored path is one it cannot open.
   */
  async register(vendor: string, fileRef: string): Promise<Registration> {
    const path = join(this.uploadDir, fileRef);
    const [size, fileSha256, boundaries] = await Promise.all([
      stat(path).then((file) => file.size),
      RegisterImportCommand.sha256(path),
      chunkBoundaries(path, this.chunkBytes),
    ]);

    const registered = await this.db.transaction(async (tx) => {
      // `file_sha256` is unique, so the same bytes twice fail here rather than in
      // a check-then-insert that two concurrent registrations both pass.
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

    // After the commit, never inside it. A queued job is visible the instant it is
    // written, so enqueueing first lets a worker claim a chunk whose row does not
    // exist yet — `claimChunk` matches nothing and nothing re-enqueues it.
    for (const boundary of registered.boundaries) {
      await this.enqueue({ jobId: registered.jobId, chunkIndex: boundary.chunkIndex });
    }

    return { jobId: registered.jobId, chunksTotal: registered.boundaries.length };
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
