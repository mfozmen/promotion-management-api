import { createApp } from './app.js';
import { loadConfig } from './shared/config.js';
import { runMigrations } from './shared/db/migrate.js';
import { eventRegistry } from './events/event-registry.js';
import { eventRouting } from './events/event-routing.js';
import { EventQueue } from './shared/queue/event-queue.js';
import { GracefulShutdown } from './shared/graceful-shutdown.js';

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
  console.log(`Server listening on port ${config.PORT}`);
});

process.on('SIGTERM', () => {
  const startedAt = Date.now();
  void new GracefulShutdown(queue, config.SHUTDOWN_DRAIN_TIMEOUT_MS)
    .run(server)
    .then((path) => {
      console.log(`Shutdown ${path} after ${Date.now() - startedAt} ms`);
      process.exit(0);
    })
    .catch((error: Error) => {
      console.error('Shutdown failed:', error.message);
      process.exit(1);
    });
});
