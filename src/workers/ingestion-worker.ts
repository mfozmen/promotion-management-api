import { eventRegistry } from '../events/event-registry.js';
import { eventRouting } from '../events/event-routing.js';
import { loadConfig } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import { EventQueue } from '../shared/queue/event-queue.js';
import type { QueueName } from '../shared/queue/queue-name.js';

// Runs the `ingestion` queue alone, under the case study's 256 MiB and 0.5 CPU limit, because
// Scenario A's claim is that a 500 000-row import survives exactly that. It connects and waits:
// the chunk processor that consumes the queue is #105, so nothing is drained here yet.
const config = loadConfig();
const queue = EventQueue.connect(
  config.REDIS_URL,
  config.REDIS_QUEUE_DB,
  eventRegistry,
  eventRouting,
);

// Typed, so a queue that does not exist fails the build instead of the log line.
const queues: QueueName[] = ['ingestion'];

logger.info(
  { worker: 'ingestion-worker', queues },
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
