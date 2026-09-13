import { eventRegistry } from '../events/event-registry.js';
import { eventRouting } from '../events/event-routing.js';
import { loadConfig } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import { EventQueue } from '../shared/queue/event-queue.js';

// Runs the `promotions` and `catalog` queues in one process (ADR-0003). It connects and waits:
// the projection that consumes them is #12, so no `Worker` is registered here yet and the
// queues are not drained. The log line says so rather than leaving an operator to infer it.
const config = loadConfig();
const queue = EventQueue.connect(
  config.REDIS_URL,
  config.REDIS_QUEUE_DB,
  eventRegistry,
  eventRouting,
);

logger.info(
  { worker: 'event-handler', queues: ['promotions', 'catalog'] },
  'connected; no consumer registered yet, so these queues are not being drained',
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
