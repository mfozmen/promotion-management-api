import { eventRegistry } from '../events/event-registry.js';
import { eventRouting } from '../events/event-routing.js';
import { loadConfig } from '../shared/config.js';
import { GracefulShutdown } from '../shared/graceful-shutdown.js';
import { logger } from '../shared/logger.js';
import { EventQueue } from '../shared/queue/event-queue.js';
import { queueDepth } from '../shared/metrics/queue-depth.js';
import { serveMetrics } from '../shared/metrics/serve-metrics.js';
import type { QueueName } from '../shared/queue/queue-name.js';

/** The three services in `docker-compose.yml`; a name that is not one of them is not a worker. */
type WorkerName = 'event-handler' | 'ingestion-worker' | 'reconciler';

interface Connected {
  config: ReturnType<typeof loadConfig>;
  queue: EventQueue<typeof eventRegistry>;
  /** What this process lets go of when a stop is signalled, besides the queue. */
  closeOnSigterm: (...also: Array<() => Promise<unknown>>) => void;
}

/**
 * Every worker process, minus what it consumes: connect, say which queues it drains, and close
 * on `SIGTERM` under the budget and the class the api uses. `EventQueue.connect` opens a
 * producer handle on all four queues in every process, so the line names what this one drains
 * rather than what it holds, and an empty list is how an idle queue is told from a drained one.
 */
export function startWorker(name: WorkerName, consuming: QueueName[] = []): Connected {
  const config = loadConfig();
  const queue = EventQueue.connect(
    config.REDIS_URL,
    config.REDIS_QUEUE_DB,
    eventRegistry,
    eventRouting,
  );

  // Every worker serves `/metrics`: the numbers a scrape wants from a queue consumer — its heap,
  // the repairs it made — exist nowhere else, and the api's registry cannot see them.
  queueDepth(queue.all());
  const metrics = serveMetrics(config.WORKER_METRICS_PORT);

  logger.info({ worker: name, consuming, metricsPort: config.WORKER_METRICS_PORT }, 'connected');

  return {
    config,
    queue,
    closeOnSigterm: (...also) => {
      process.once('SIGTERM', () => {
        void new GracefulShutdown(queue, config.SHUTDOWN_DRAIN_TIMEOUT_MS)
          .close(...also, () => new Promise<void>((resolve) => metrics.close(() => resolve())))
          .then((path) => {
            logger.info({ worker: name, path }, 'shutdown complete');
            // A forced path abandoned whatever was mid-flight, so it is not a clean exit: `0`
            // tells the orchestrator the process finished what it was doing.
            process.exit(path === 'drained' ? 0 : 1);
          })
          .catch((error: unknown) => {
            logger.error({ worker: name, err: error }, 'shutdown failed');
            process.exit(1);
          });
      });
    },
  };
}
