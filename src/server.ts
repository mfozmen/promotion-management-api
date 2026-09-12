import { createApp } from './app.js';
import { closeQueues, createQueues } from './shared/queue.js';

const port = Number(process.env.PORT) || 3000;
const app = createApp();
const queues = createQueues(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

// REVIEW.md 3.11: stop accepting work, let what is in flight finish, then exit.
// Without closing the queues the ioredis sockets keep the event loop alive and
// the orchestrator's SIGTERM becomes a SIGKILL nine seconds later.
process.on('SIGTERM', () => {
  server.close(() => {
    void closeQueues(queues).finally(() => process.exit(0));
  });
});
