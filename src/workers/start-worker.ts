import { eventRegistry } from '../events/event-registry.js';
import { eventRouting } from '../events/event-routing.js';
import { loadConfig } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import { EventQueue } from '../shared/queue/event-queue.js';

/**
 * Every worker process, minus its name: connect, say what is and is not happening, and close
 * the queue on SIGTERM. The three entry points differ in a string, so they are two lines each
 * and this is the file that is tested.
 */
export function startWorker(name: string): void {
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
    void stop(queue, config.SHUTDOWN_DRAIN_TIMEOUT_MS);
  });
}

/** Bounded: Redis is often what is already gone at shutdown, and `close()` then never settles. */
async function stop(queue: Pick<EventQueue<never>, 'close'>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const closed = await Promise.race([
      queue.close().then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    if (!closed) logger.warn(`the queue did not close within ${String(timeoutMs)}ms; exiting`);
    process.exit(0);
  } catch (error: unknown) {
    logger.error({ err: error }, 'queue close failed');
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
}
