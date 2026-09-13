import { eventRegistry } from '../events/event-registry.js';
import { eventRouting } from '../events/event-routing.js';
import { loadConfig } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import { EventQueue } from '../shared/queue/event-queue.js';

// Runs the `maintenance` queue plus its own repeatable schedule (ADR-0003). It connects and
// waits: the boundary sweep it will call lands in `src/workers/reconciler/` with its own pull
// request, so nothing is drained or scheduled here yet. The seam is a directory rather than an
// import, because an import of a module that does not exist fails the build instead of idling.
const config = loadConfig();
const queue = EventQueue.connect(
  config.REDIS_URL,
  config.REDIS_QUEUE_DB,
  eventRegistry,
  eventRouting,
);

logger.info(
  { worker: 'reconciler', queues: ['maintenance'] },
  'connected; no consumer registered yet, so this queue is not being drained',
);

process.once('SIGTERM', () => {
  void queue
    .close()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      logger.error({ err: error }, 'queue close failed');
      process.exit(1);
    });
});
