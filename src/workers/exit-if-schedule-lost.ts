import { logger } from '../shared/logger.js';

/** The prose BullMQ builds this error from; this file's test reads the library's own
 *  source for it, because it is a template string rather than anything the API promises. */
const SCHEDULE_LOST = 'Failed to add repeatable job';

/**
 * BullMQ upserts the next iteration of a repeatable job when the worker picks one up, and on a
 * failure it emits this and returns rather than throwing — so the chain stops for ever while the
 * process stays up. Exiting lets the restart re-assert the schedule at boot, which is the only
 * place it is asserted at all; re-asserting per run would be a hot loop, since the upsert
 * enqueues its first iteration immediately.
 */
export function exitIfScheduleLost(worker: string, error: Error): void {
  logger.error({ worker, err: error }, 'worker error');
  if (error.message.startsWith(SCHEDULE_LOST)) process.exit(1);
}
