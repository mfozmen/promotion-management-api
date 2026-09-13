import type { Logger } from 'pino';
import type { Enqueue } from '../../../shared/enqueue.js';
import type { PromotionBoundaries } from '../../../shared/promotion-boundaries.js';

/**
 * What announcing a promotion change needs, and the contract both announcers
 * honour: every step is attempted independently and a failure is logged rather
 * than raised. The row is committed by the time either runs, so telling the
 * admin their write failed would be false.
 *
 * Nothing repairs the read model automatically yet — ADR-0007's reconciler is
 * not built — so until it lands, a lost event means a stale entry until that
 * promotion changes again.
 */
export interface Announcement {
  enqueue: Enqueue;
  boundaries: PromotionBoundaries;
  log: Logger;
}
