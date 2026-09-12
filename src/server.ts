import { createApp } from './app.js';
import { createQueues } from './shared/queue.js';
import { parseShutdownTimeout, shutdown } from './shared/shutdown.js';

const port = Number(process.env.PORT) || 3000;
const shutdownTimeoutMs = parseShutdownTimeout(process.env.SHUTDOWN_TIMEOUT_MS);
const app = createApp();
const queues = createQueues(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

// REVIEW.md 3.11. The ordering is the mechanism: closing the queues does not
// drain them, so the HTTP server goes first and nothing is still producing when
// the sockets close, which otherwise hold the loop open until SIGKILL.
process.on('SIGTERM', () => {
  const startedAt = Date.now();
  void shutdown(server, queues, shutdownTimeoutMs)
    .then((path) => {
      console.log(`Shutdown ${path} after ${Date.now() - startedAt} ms`);
      process.exit(0);
    })
    .catch((error: Error) => {
      console.error('Shutdown failed:', error.message);
      process.exit(1);
    });
});
