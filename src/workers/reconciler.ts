import { Worker } from 'bullmq';
import { SweepBoundariesCommand } from '../modules/reconciler/commands/sweep-boundaries-command.js';
import { BoundaryRepository } from '../modules/reconciler/db/boundary-repository.js';
import { ReconcilerRunHandler } from '../modules/reconciler/events/reconciler-run-handler.js';
import { createDb, createPool } from '../shared/db/client.js';
import { logger } from '../shared/logger.js';
import { isScheduleLost } from './is-schedule-lost.js';
import { startWorker } from './start-worker.js';

/** Spec section 9. The window the sweep reads is the watermark's, so a missed run costs
 *  latency and not coverage: the next one takes everything since the last success. */
const SWEEP_EVERY_MS = 5 * 60 * 1000;

const { config, queue, closeOnSigterm } = startWorker('reconciler', ['maintenance']);
const pool = createPool(config.DATABASE_URL);
const handler = new ReconcilerRunHandler(
  new SweepBoundariesCommand(new BoundaryRepository(createDb(pool)), queue, logger),
);

const worker = new Worker(
  'maintenance',
  async (job) => {
    await handler.handle(job.name);
  },
  { connection: { url: config.REDIS_URL, db: config.REDIS_QUEUE_DB } },
);

// Without this listener the schedule dies silently: BullMQ emits the failure and keeps
// running, and `QueueBase.emit` swallows the throw from an unhandled `error` into stderr.
// Exiting lets the restart policy re-assert the schedule at boot, which is the only place
// it is asserted at all.
worker.on('error', (error: Error) => {
  logger.error({ worker: 'reconciler', err: error }, 'worker error');
  if (isScheduleLost(error)) process.exit(1);
});

await queue.schedule('reconciler.run', SWEEP_EVERY_MS, {});

// The consumer stops before the pool it reads through and the producer handle it publishes on.
closeOnSigterm(
  () => worker.close(),
  () => pool.end(),
);
