import { Worker } from 'bullmq';
import { RepairDriftCommand } from '../modules/reconciler/commands/repair-drift-command.js';
import { SweepBoundariesCommand } from '../modules/reconciler/commands/sweep-boundaries-command.js';
import { SweepOrphanChunksCommand } from '../modules/reconciler/commands/sweep-orphan-chunks-command.js';
import { OrphanChunkRepository } from '../modules/reconciler/db/orphan-chunk-repository.js';
import { BoundaryRepository } from '../modules/reconciler/db/boundary-repository.js';
import { ReconcilerRunHandler } from '../modules/reconciler/events/reconciler-run-handler.js';
import { MaintenanceDispatcher } from '../events/maintenance-dispatcher.js';
import { readModelConsumer } from '../modules/storefront/read-model-consumer.js';
import { createDb, createPool } from '../shared/db/client.js';
import { logger } from '../shared/logger.js';
import { driftRepairs } from '../shared/metrics/drift-repairs.js';
import { queueDepth } from '../shared/metrics/queue-depth.js';
import { createReadModelWriterClient } from '../shared/read-model-writer-client.js';
import { exitIfScheduleLost } from './exit-if-schedule-lost.js';
import { startWorker } from './start-worker.js';

/** Spec section 9. The window the sweep reads is the watermark's, so a missed run costs
 *  latency and not coverage: the next one takes everything since the last success. */
const SWEEP_EVERY_MS = 5 * 60 * 1000;

const { config, queue, closeOnSigterm } = startWorker('reconciler', ['maintenance']);
const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);
// The writer's own client: the storefront's gives up after one retry and times
// a command out in a second, which is right for a request and wrong for a
// rebuild's pipelines.
const readModel = createReadModelWriterClient(config.REDIS_URL, config.REDIS_READ_MODEL_DB);
const {
  rebuild,
  source,
  readModel: listing,
  rebuildCategory,
} = await readModelConsumer(db, readModel, queue, logger);
const handler = new MaintenanceDispatcher(
  new ReconcilerRunHandler(
    new SweepBoundariesCommand(new BoundaryRepository(db), queue, logger),
    new SweepOrphanChunksCommand(new OrphanChunkRepository(db), queue, logger),
    new RepairDriftCommand(source, listing, rebuildCategory, driftRepairs, logger),
    logger,
  ),
  rebuild,
);

// One process reports the depths, and this is it: a queue's depth is shared state,
// so four processes answering would be four copies of one number. The reconciler
// is the one that is always running and consumes the least.
queueDepth(queue, ['promotions', 'products', 'ingestion', 'maintenance'], logger);

const worker = new Worker(
  'maintenance',
  async (job) => {
    await handler.handle(job.name, job.data);
  },
  { connection: { url: config.REDIS_URL, db: config.REDIS_QUEUE_DB } },
);

worker.on('error', (error: Error) => exitIfScheduleLost('reconciler', error));

await queue.schedule('reconciler.run', SWEEP_EVERY_MS, {});

// The consumer stops before the pool it reads through and the producer handle it publishes on.
closeOnSigterm(
  () => worker.close(),
  () => readModel.quit(),
  () => pool.end(),
);
