import { createApp } from './app.js';
import { eventRegistry } from './events/event-registry.js';
import { eventRouting } from './events/event-routing.js';
import { PromotionScheduler } from './modules/promotion/domain/promotion-scheduler.js';
import { loadConfig } from './shared/config.js';
import { createDb, createPool } from './shared/db/client.js';
import { runMigrations } from './shared/db/migrate.js';
import { GracefulShutdown } from './shared/graceful-shutdown.js';
import { logger } from './shared/logger.js';
import { ProductReadRepository } from './modules/storefront/db/product-read-repository.js';
import { createReadModelClient } from './shared/read-model-client.js';
import { EventQueue } from './shared/queue/event-queue.js';
import { queueDepth } from './shared/metrics/queue-depth.js';
import { dependencyUp } from './shared/metrics/dependency-up.js';
import { DependencyReadiness } from './shared/dependency-readiness.js';

const config = loadConfig();

// The health check `up --wait` waits on must not answer in front of a missing schema.
await runMigrations(config.DATABASE_URL);

const pool = createPool(config.DATABASE_URL);
const queue = EventQueue.connect(
  config.REDIS_URL,
  config.REDIS_QUEUE_DB,
  eventRegistry,
  eventRouting,
);
// Read at scrape time from the handles this process already holds.
queueDepth(queue.all());

const db = createDb(pool);
const products = new ProductReadRepository(
  createReadModelClient(config.REDIS_URL, config.REDIS_READ_MODEL_DB),
);

// Asked on every scrape, so a report can say whether the stores answered during a run and not
// only when someone looked. Registered here rather than in `createApp`: a gauge that queries the
// stores would otherwise be built by every test that renders an app.
dependencyUp(new DependencyReadiness(db, products));

const app = createApp({
  logger,
  db,
  queue,
  scheduler: new PromotionScheduler(queue),
  products,
  boardQueues: queue.all(),
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'listening');
});

// The ordering is the mechanism: closing the queues does not drain them, so the
// HTTP server goes first and nothing is still producing when the sockets close.
process.on('SIGTERM', () => {
  const startedAt = Date.now();
  // The pool goes inside the budget rather than after it: awaited outside, it could hang
  // past the grace period and turn a clean stop into an unexplained exit 137.
  void new GracefulShutdown(queue, config.SHUTDOWN_DRAIN_TIMEOUT_MS)
    .run(server, () => pool.end())
    .then((path) => {
      logger.info({ path, ms: Date.now() - startedAt }, 'shutdown complete');
      process.exit(0);
    })
    .catch((error: unknown) => {
      logger.error({ err: error }, 'shutdown failed');
      process.exit(1);
    });
});
