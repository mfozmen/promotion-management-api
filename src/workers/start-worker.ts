import { eventRegistry } from '../events/event-registry.js';
import { eventRouting } from '../events/event-routing.js';
import { loadConfig } from '../shared/config.js';
import { GracefulShutdown } from '../shared/graceful-shutdown.js';
import { logger } from '../shared/logger.js';
import { EventQueue } from '../shared/queue/event-queue.js';

/** The three services in `docker-compose.yml`; a name that is not one of them is not a worker. */
type WorkerName = 'event-handler' | 'ingestion-worker' | 'reconciler';

interface Started {
  config: ReturnType<typeof loadConfig>;
  queue: EventQueue<typeof eventRegistry>;
  /** What this process lets go of on `SIGTERM` besides the queue; the caller adds its own. */
  stopping: (...also: Array<() => Promise<unknown>>) => void;
}

/**
 * Every worker process, minus what it consumes: connect, say which queues it drains, and close
 * on `SIGTERM` under the budget and the class the api uses. `EventQueue.connect` opens a
 * producer handle on all four queues in every process, so the line names what this one drains
 * rather than what it holds, and an empty list is how an idle queue is told from a drained one.
 */
export function startWorker(name: WorkerName, consuming: string[] = []): Started {
  const config = loadConfig();
  const queue = EventQueue.connect(
    config.REDIS_URL,
    config.REDIS_QUEUE_DB,
    eventRegistry,
    eventRouting,
  );

  logger.info({ worker: name, consuming }, 'connected');

  return {
    config,
    queue,
    stopping: (...also) => {
      process.once('SIGTERM', () => {
        void new GracefulShutdown(queue, config.SHUTDOWN_DRAIN_TIMEOUT_MS)
          .close(...also)
          .then((path) => {
            logger.info({ worker: name, path }, 'shutdown complete');
            process.exit(0);
          })
          .catch((error: unknown) => {
            logger.error({ worker: name, err: error }, 'shutdown failed');
            process.exit(1);
          });
      });
    },
  };
}
