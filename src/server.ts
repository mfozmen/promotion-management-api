import { createApp } from './app.js';
import { loadConfig } from './shared/config.js';
import { createDb, createPool } from './shared/db/client.js';
import { logger } from './shared/logger.js';
import { queueEnqueue } from './shared/queue-enqueue.js';
import { queuePromotionBoundaries } from './shared/queue-promotion-boundaries.js';
import { createQueues } from './shared/queue.js';
import { parseShutdownTimeout, shutdown } from './shared/shutdown.js';

const config = loadConfig();
const shutdownTimeoutMs = parseShutdownTimeout(process.env.SHUTDOWN_TIMEOUT_MS);
const pool = createPool(config.DATABASE_URL);
const queues = createQueues(config.REDIS_URL);

// Every dependency the routes need is passed here, because `createApp` mounts a
// route only when it has them: an omission is a 404 in production and a green
// suite, since every test builds its own. This file is excluded from coverage
// (REVIEW.md 7.2), so nothing but reading it catches that.
const app = createApp({
  logger,
  db: createDb(pool),
  enqueue: queueEnqueue(queues),
  boundaries: queuePromotionBoundaries(queues),
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'listening');
});

// The ordering is the mechanism: closing the queues does not
// drain them, so the HTTP server goes first and nothing is still producing when
// the sockets close, which otherwise hold the loop open until SIGKILL.
process.on('SIGTERM', () => {
  const startedAt = Date.now();
  void shutdown(server, queues, shutdownTimeoutMs)
    .then(async (path) => {
      await pool.end();
      logger.info({ path, durationMs: Date.now() - startedAt }, 'shutdown complete');
      process.exit(0);
    })
    .catch((error: Error) => {
      logger.error({ error: { message: error.message } }, 'shutdown failed');
      process.exit(1);
    });
});
