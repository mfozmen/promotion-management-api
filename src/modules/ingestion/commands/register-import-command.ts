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
export class RegisterImportCommand {
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

      return { jobId, boundaries };
    });

    // After the commit, never inside it. A queued job is visible to a worker the
    // instant it is written, so enqueueing before the rows commit lets a worker
    // claim a chunk that does not exist yet: `claimChunk` matches no row, returns
    // `claimed: false` as it does for an ordinary duplicate delivery, and nothing
    // re-enqueues it — one chunk of the import silently never runs.
    //
    // The trade this replaces was the wrong way round. Enqueueing inside the
    // transaction bought atomicity against an orphan job row, which is visible and
    // recoverable: the chunks exist and can be re-enqueued. A chunk nobody ever
    // claims is neither. Commit first and publish after, as every other write path
    // here does (REVIEW.md 3.4).
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
