import { createApp } from './app.js';
import { eventRegistry } from './events/event-registry.js';
import { eventRouting } from './events/event-routing.js';
import { loadConfig } from './shared/config.js';
import { runMigrations } from './shared/db/migrate.js';
import { GracefulShutdown } from './shared/graceful-shutdown.js';
import { logger } from './shared/logger.js';
import { EventQueue } from './shared/queue/event-queue.js';
import { serializeError } from './shared/serialize-error.js';

const config = loadConfig();

// The health check `up --wait` waits on must not answer in front of a missing schema.
await runMigrations(config.DATABASE_URL);

const app = createApp();
const queue = EventQueue.connect(
  config.REDIS_URL,
  config.REDIS_QUEUE_DB,
  eventRegistry,
  eventRouting,
);

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'listening');
});

process.on('SIGTERM', () => {
  const startedAt = Date.now();
  void new GracefulShutdown(queue, config.SHUTDOWN_DRAIN_TIMEOUT_MS)
    .run(server)
    .then((path) => {
      logger.info({ path, ms: Date.now() - startedAt }, 'shutdown complete');
      process.exit(0);
    })
    .catch((error: unknown) => {
      logger.error({ error: serializeError(error) }, 'shutdown failed');
      process.exit(1);
    });
});
