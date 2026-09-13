import type { PromotionBoundary } from '../modules/promotion/domain/dto/promotion-boundary.js';

/**
 * Scheduling a promotion's start and end, narrowed to what a handler does with
 * it. `now` is a parameter because the instant comes back from the write that
 * decided it: PostgreSQL's clock, never the process's (REVIEW.md 2.7).
 */
export interface PromotionBoundaries {
  schedule(promotionId: number, boundary: PromotionBoundary, at: Date, now: Date): Promise<unknown>;
  remove(promotionId: number): Promise<unknown>;
}
