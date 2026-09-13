import { createApp } from './app.js';
import { loadConfig } from './shared/config.js';
import { runMigrations } from './shared/db/migrate.js';
import { registry } from './events/registry.js';
import { routing } from './events/routing.js';
import { EventQueue } from './shared/queue/event-queue.js';
import { GracefulShutdown } from './shared/graceful-shutdown.js';

const config = loadConfig();

// Before the first request rather than beside it: the health check is what `up --wait`
// waits on, so it must not answer in front of a schema that is not there yet.
await runMigrations(config.DATABASE_URL);

const app = createApp();
const queue = EventQueue.connect(config.REDIS_URL, config.REDIS_QUEUE_DB, registry, routing);

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
