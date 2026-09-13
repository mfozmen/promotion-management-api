import type { PromotionBoundary } from '../domain/dto/promotion-boundary.js';
import type { EventBus } from '../../../shared/event-bus.js';
import type { PromotionBoundaries } from '../domain/dto/promotion-boundaries.js';

/** The one implementation of `PromotionBoundaries`, over the event bus's delayed jobs. */
export class QueuePromotionBoundaries implements PromotionBoundaries {
  constructor(private readonly bus: EventBus) {}

  async schedule(
    promotionId: number,
    boundary: PromotionBoundary,
    at: Date,
    now: Date,
  ): Promise<unknown> {
    return this.bus.schedulePromotionBoundary(promotionId, boundary, at, now);
  }

  async remove(promotionId: number): Promise<unknown> {
    return this.bus.removePromotionBoundaries(promotionId);
  }
}
