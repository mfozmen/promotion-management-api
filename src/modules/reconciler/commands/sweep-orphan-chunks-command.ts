import type { Logger } from 'pino';

interface OrphanChunks {
  orphaned(graceMs: number): Promise<{ jobId: number; chunkIndex: number }[]>;
  runningJobIds(): Promise<number[]>;
}

interface Imports {
  completeJobIfDone(jobId: number): Promise<boolean>;
}

interface AnnouncementQueue {
  publish(name: 'chunk.process', payload: { jobId: number; chunkIndex: number }): Promise<unknown>;
}

/**
 * Gives an abandoned import a worker again. A chunk whose holder died keeps an
 * expired lease and nothing re-enqueues it, so the job stays `running` and
 * `ingestion_jobs_one_running_per_vendor` refuses that vendor's next import for
 * ever (issue #134). Re-enqueueing is safe by construction: `claimChunk` is a
 * guarded `UPDATE` that matches only a pending or expired chunk, so a duplicate
 * job finds nothing and does nothing.
 */
export class SweepOrphanChunksCommand {
  constructor(
    private readonly chunks: OrphanChunks,
    private readonly imports: Imports,
    private readonly queue: AnnouncementQueue,
    private readonly graceMs: number,
    private readonly logger: Logger,
  ) {}

  async execute(): Promise<number> {
    const settled: number[] = [];

    for (const jobId of await this.chunks.runningJobIds())
      if (await this.imports.completeJobIfDone(jobId)) settled.push(jobId);

    const orphans = await this.chunks.orphaned(this.graceMs);
    let enqueued = 0;

    for (const { jobId, chunkIndex } of orphans) {
      try {
        // No custom job id. One would be deduplicated against BullMQ's kept
        // completed and failed keys, so the second attempt at a chunk would
        // return the old job and queue nothing — the sweep would stop working
        // on exactly the chunk that needed it twice. A duplicate delivery costs
        // one `UPDATE` that matches no row.
        await this.queue.publish('chunk.process', { jobId, chunkIndex });
        enqueued += 1;
      } catch (error) {
        // One unreachable publish must not strand the chunks after it: the next
        // sweep finds this one still orphaned.
        this.logger.error({ jobId, chunkIndex, err: error }, 'could not re-enqueue a chunk');
      }
    }

    if (settled.length > 0 || orphans.length > 0)
      this.logger.warn(
        { settled, enqueued, orphaned: orphans.length },
        'abandoned imports were swept',
      );

    return enqueued;
  }
}
