import { Worker } from 'bullmq';
import { and, asc, desc, eq } from 'drizzle-orm';
import { ChunkProcessHandler } from '../modules/ingestion/events/chunk-process-handler.js';
import { pricingRules } from '../modules/pricing/db/schema/pricing-rules.js';
import { BasePriceCalculatorCache } from '../modules/pricing/domain/base-price-calculator-cache.js';
import { ProductRepository } from '../modules/product/db/product-repository.js';
import { createDb, createPool } from '../shared/db/client.js';
import { logger } from '../shared/logger.js';
import { startWorker } from './start-worker.js';

const { config, queue, closeOnSigterm } = startWorker('ingestion-worker', ['ingestion']);

const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);

// Both predicates, so the partial index `pricing_rules_active_idx` serves the query.
const calculators = new BasePriceCalculatorCache({
  now: () => Date.now(),
  source: () =>
    db
      .select()
      .from(pricingRules)
      .where(and(eq(pricingRules.type, 'ingestion'), eq(pricingRules.active, true)))
      .orderBy(desc(pricingRules.priority), asc(pricingRules.id)),
});

const handler = new ChunkProcessHandler({
  db,
  products: new ProductRepository(db),
  calculators,
  // Copied because the event schema owns a mutable array and the processor hands
  // out a readonly view of the ids it just stored.
  publish: (productIds) => queue.publish('product.upserted', { productIds: [...productIds] }),
  reenqueue: (chunk) => queue.publish('chunk.process', chunk),
  log: logger,
  batchSize: config.INGESTION_BATCH_SIZE,
  budgetMs: config.INGESTION_BUDGET_MS,
  leaseMs: config.INGESTION_LEASE_MS,
  uploadDir: config.UPLOAD_DIR,
  maxFailures: config.INGESTION_MAX_FAILURES,
});

const worker = new Worker(
  'ingestion',
  async (job) => {
    const outcome = await handler.handle(job.data);
    // Reported per chunk, from inside the process, because that is the only
    // vantage point that can see this worker rather than every node on the host
    // or a container built from a different commit. `heapUsed` is what
    // `--max-old-space-size` bounds; the container's own accounting is a
    // different number and the cgroup is where it is read.
    const { heapUsed, rss } = process.memoryUsage();
    logger.info(
      { ...outcome, heapUsedMb: Math.round(heapUsed / 1048576), rssMb: Math.round(rss / 1048576) },
      'chunk finished',
    );
    return outcome;
  },
  {
    connection: { url: config.REDIS_URL, db: config.REDIS_QUEUE_DB },
    concurrency: ChunkProcessHandler.CONCURRENCY,
    // Longer than the budget the handler gives itself, or the queue hands the
    // same chunk to a second worker while this one is still inside a batch.
    lockDuration: ChunkProcessHandler.lockDurationFor(config.INGESTION_BUDGET_MS),
  },
);

worker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, name: job?.name, err: error }, 'chunk job failed');
});

worker.on('error', (error) => {
  // An `error` event with no listener is an uncaught exception.
  logger.error({ err: error }, 'ingestion worker error');
});

// The worker closes before the queue and the pool: `close()` waits for the job in
// flight, which the budget bounds, and the chunk's own checkpoint is what makes a
// harder stop survivable anyway.
closeOnSigterm(
  () => worker.close(),
  () => pool.end(),
);
