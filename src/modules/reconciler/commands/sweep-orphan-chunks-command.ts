import type { Logger } from 'pino';

interface OrphanChunks {
  orphaned(): Promise<{ jobId: number; chunkIndex: number }[]>;
  settleFinishedJobs(): Promise<number[]>;
}

interface AnnouncementQueue {
  publish(
    name: 'chunk.process',
    payload: { jobId: number; chunkIndex: number },
    options?: { jobId?: string },
  ): Promise<unknown>;
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
    private readonly queue: AnnouncementQueue,
    private readonly logger: Logger,
  ) {}

  /** Keyed on the chunk, so a sweep that runs while the last one's jobs are still
   *  queued adds nothing. */
  static jobId(jobId: number, chunkIndex: number): string {
    return `chunk:${String(jobId)}:${String(chunkIndex)}`;
  }

  async execute(): Promise<number> {
    const settled = await this.chunks.settleFinishedJobs();
    const orphans = await this.chunks.orphaned();
    let enqueued = 0;

    for (const { jobId, chunkIndex } of orphans) {
      try {
        await this.queue.publish(
          'chunk.process',
          { jobId, chunkIndex },
          { jobId: SweepOrphanChunksCommand.jobId(jobId, chunkIndex) },
        );
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
