import { createApp } from './app.js';
import { loadConfig } from './shared/config.js';
import { runMigrations } from './shared/db/migrate.js';
import { EventBus } from './shared/event-bus.js';
import { parseShutdownTimeout, shutdown } from './shared/shutdown.js';

const config = loadConfig();
const shutdownTimeoutMs = parseShutdownTimeout(process.env.SHUTDOWN_TIMEOUT_MS);

// Before the first request rather than beside it: the health check is what `up --wait`
// waits on, so it must not answer in front of a schema that is not there yet.
await runMigrations(config.DATABASE_URL);

const app = createApp();
const bus = EventBus.connect(config.REDIS_URL);

const server = app.listen(config.PORT, () => {
  console.log(`Server listening on port ${config.PORT}`);
});

process.on('SIGTERM', () => {
  const startedAt = Date.now();
  void shutdown(server, bus, shutdownTimeoutMs)
    .then((path) => {
      console.log(`Shutdown ${path} after ${Date.now() - startedAt} ms`);
      process.exit(0);
    })
    .catch((error: Error) => {
      console.error('Shutdown failed:', error.message);
      process.exit(1);
    });
});
