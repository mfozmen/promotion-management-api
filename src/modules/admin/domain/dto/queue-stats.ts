import type { QueueName } from '../../../../shared/queue/queue-name.js';

export interface QueueStats {
  queue: QueueName;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  /**
   * Null when the read returned no waiting job, which is not the same fact as an age of
   * zero. It is read separately from `waiting`, so the two can disagree by one poll.
   */
  oldestWaitingAgeSeconds: number | null;
}
