import type { Logger } from 'pino';
import type { BoundaryWindow } from '../domain/dto/boundary-window.js';

interface Boundaries {
  crossedSince(): Promise<BoundaryWindow>;
  advance(from: Date, to: Date): Promise<boolean>;
}

interface AnnouncementQueue {
  publish(
    name: 'promotion.changed',
    payload: { promotionId: number },
    options?: { jobId?: string },
  ): Promise<unknown>;
}

/**
 * Re-emits `promotion.changed` for every promotion whose window opened, closed or
 * was cancelled since the last successful sweep, and for one born already running.
 * It is the repair for an announcement that was never published — a crash between
 * the commit and the enqueue, or a Redis that refused the write (ADR-0007).
 */
export class SweepBoundariesCommand {
  constructor(
    private readonly boundaries: Boundaries,
    private readonly queue: AnnouncementQueue,
    private readonly logger: Logger,
  ) {}

  async execute(): Promise<void> {
    const { since, windowEnd, promotionIds } = await this.boundaries.crossedSince();

    for (const promotionId of promotionIds) {
      // The window's end is in the id, so a re-swept window enqueues the same job
      // rather than a second full recompute of the same category.
      await this.queue.publish(
        'promotion.changed',
        { promotionId },
        { jobId: `sweep:${String(promotionId)}:${windowEnd.toISOString()}` },
      );
    }

    // The watermark moves only if this sweep still owns it; a loser re-reads the
    // window, which costs a repeat the handler is idempotent about.
    if (!(await this.boundaries.advance(since, windowEnd))) {
      this.logger.warn(
        { since, windowEnd },
        'another sweep advanced the watermark first; this window will be read again',
      );
    }
  }
}
