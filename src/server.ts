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
const app = createApp({
  logger,
  db: createDb(pool),
  queue,
  scheduler: new PromotionScheduler(queue),
  products: new ProductReadRepository(
    createReadModelClient(config.REDIS_URL, config.REDIS_READ_MODEL_DB),
  ),
  boardQueues: queue.all(),
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'listening');
});

// The ordering is the mechanism: closing the queues does not drain them, so the
// HTTP server goes first and nothing is still producing when the sockets close.
process.on('SIGTERM', () => {
  const startedAt = Date.now();
  void new GracefulShutdown(queue, config.SHUTDOWN_DRAIN_TIMEOUT_MS)
    .run(server)
    .then(async (path) => {
      await pool.end();
      logger.info({ path, ms: Date.now() - startedAt }, 'shutdown complete');
      process.exit(0);
    })
    .catch((error: unknown) => {
      logger.error({ err: error }, 'shutdown failed');
      process.exit(1);
    });
});
