import { eventRegistry } from '../events/event-registry.js';
import { eventRouting } from '../events/event-routing.js';
import { loadConfig } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import { EventQueue } from '../shared/queue/event-queue.js';

/** The three services in `docker-compose.yml`; a name that is not one of them is not a worker. */
type WorkerName = 'event-handler' | 'ingestion-worker' | 'reconciler';

/** Every worker process, minus its name: connect, say what is happening, close on SIGTERM. */
export function startWorker(name: WorkerName): void {
  const config = loadConfig();
  const queue = EventQueue.connect(
    config.REDIS_URL,
    config.REDIS_QUEUE_DB,
    eventRegistry,
    eventRouting,
  );

  // `EventQueue.connect` opens a producer handle on all four queues, so no worker holds a
  // subset and saying which it holds would be a claim the code does not make. What an operator
  // needs from this line is that an idle queue here is not a drained one.
  logger.info(
    { worker: name },
    'connected as a producer on every queue; no consumer is registered, so nothing is drained',
  );

  process.once('SIGTERM', () => {
    void stop(name, queue, config.SHUTDOWN_DRAIN_TIMEOUT_MS);
  });
}

/** Bounded: Redis is often what is already gone at shutdown, and `close()` then never settles. */
async function stop(
  name: WorkerName,
  queue: Pick<EventQueue<never>, 'close'>,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const closed = await Promise.race([
      queue.close().then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    if (!closed) logger.warn({ worker: name }, `no close within ${String(timeoutMs)}ms; exiting`);
    process.exit(0);
  } catch (error: unknown) {
    logger.error({ worker: name, err: error }, 'queue close failed');
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
}
