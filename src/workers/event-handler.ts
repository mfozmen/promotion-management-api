import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { readModelConsumer } from '../modules/storefront/read-model-consumer.js';
import { createDb, createPool } from '../shared/db/client.js';
import { logger } from '../shared/logger.js';
import { startWorker } from './start-worker.js';

const { config, queue, closeOnSigterm } = startWorker('event-handler', ['products', 'promotions']);
const pool = createPool(config.DATABASE_URL);
const readModel = new Redis(config.REDIS_URL, { db: config.REDIS_READ_MODEL_DB });
const { upserted, promotionChanged, rebuildOnBoot } = await readModelConsumer(
  createDb(pool),
  readModel,
  queue,
  logger,
);

// Before anything is consumed: an empty read model answers 503 to every shopper,
// and no job arrives to fix that because nothing enqueues one.
await rebuildOnBoot();

const workers = [
  new Worker('products', async (job) => upserted.handle(job.data), {
    connection: { url: config.REDIS_URL, db: config.REDIS_QUEUE_DB },
  }),
  new Worker('promotions', async (job) => promotionChanged.handle(job.data), {
    connection: { url: config.REDIS_URL, db: config.REDIS_QUEUE_DB },
  }),
];

closeOnSigterm(
  () => Promise.all(workers.map((worker) => worker.close())),
  () => readModel.quit(),
  () => pool.end(),
);
