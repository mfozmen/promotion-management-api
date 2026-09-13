import type { Logger } from 'pino';

interface BoundaryWindow {
  promotionIds: number[];
  windowEnd: Date;
}

interface Watermark {
  crossedSince(): Promise<BoundaryWindow>;
  advanceWatermark(to: Date): Promise<void>;
}

interface AnnouncementQueue {
  publish(name: 'promotion.changed', payload: { promotionId: number }): Promise<unknown>;
}

/**
 * Re-emits `promotion.changed` for every promotion whose window opened, closed or
 * was cancelled since the last successful sweep. It is the repair for an
 * announcement that was never published — a crash between the commit and the
 * enqueue, or a Redis that refused the write (ADR-0007).
 */
export class BoundarySweep {
  constructor(
    private readonly watermark: Watermark,
    private readonly queue: AnnouncementQueue,
    private readonly logger: Logger,
  ) {}

  async run(): Promise<void> {
    const { promotionIds, windowEnd } = await this.watermark.crossedSince();

    for (const promotionId of promotionIds) {
      try {
        await this.queue.publish('promotion.changed', { promotionId });
      } catch (error) {
        // The watermark stays where it is, so the whole window is read again next
        // run. A repeat costs a recompute the handler is idempotent about; a skip
        // costs a stale price with nothing left to repair it.
        this.logger.error(
          { promotionId, err: error },
          'boundary sweep did not complete; the window will be read again',
        );

        return;
      }
    }

    await this.watermark.advanceWatermark(windowEnd);
  }
}
