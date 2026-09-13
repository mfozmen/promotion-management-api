import type { PromotionBoundaries } from './promotion-boundaries.js';
import {
  removePromotionBoundaries,
  schedulePromotionBoundary,
  type Queues,
} from './queue.js';

/**
 * The one implementation of `PromotionBoundaries`, over the BullMQ delayed jobs
 * in `queue.js`. The port exists so a handler can be tested without a broker;
 * this is what the running process passes it (REVIEW.md 12.1).
 */
export function queuePromotionBoundaries(queues: Queues): PromotionBoundaries {
  return {
    schedule: (promotionId, boundary, at, now) =>
      schedulePromotionBoundary(queues, promotionId, boundary, at, now),
    remove: (promotionId) => removePromotionBoundaries(queues, promotionId),
  };
}
