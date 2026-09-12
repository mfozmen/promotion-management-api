import { createApp } from './app.js';
import { closeQueues, createQueues } from './shared/queue.js';

const port = Number(process.env.PORT) || 3000;
const app = createApp();
const queues = createQueues(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

// REVIEW.md 3.11. The ordering is the mechanism: closing the queues does not
// drain them, so the HTTP server goes first and nothing is still producing when
// the sockets close, which otherwise hold the loop open until SIGKILL.
process.on('SIGTERM', () => {
  server.close(() => {
    void closeQueues(queues).finally(() => process.exit(0));
  });
});
