import type { Announcement } from './announcement.js';
import { settleAnnouncement } from './settle-announcement.js';

/**
 * The event goes first and the boundary removal follows, which is the opposite
 * of the order this once had.
 *
 * Removing the delayed jobs is hygiene, not correctness: a boundary job's
 * payload is `{ promotionId }` and the handler recomputes from PostgreSQL, so
 * one that fires for a cancelled promotion reads the cancelled row and
 * publishes the base price. Emitting the event is the correctness half, so it
 * cannot sit behind a call that may time out.
 */
export async function announceCancellation(
  promotionId: number,
  deps: Announcement,
): Promise<void> {
  await settleAnnouncement(deps.enqueue('promotion.changed', { promotionId }), promotionId, deps);
  await settleAnnouncement(deps.boundaries.remove(promotionId), promotionId, deps);
}
