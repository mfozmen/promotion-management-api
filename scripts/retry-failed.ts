import { eventRegistry } from '../src/events/event-registry.js';
import { eventRouting } from '../src/events/event-routing.js';
import { loadConfig } from '../src/shared/config.js';
import { logger } from '../src/shared/logger.js';
import { EventQueue } from '../src/shared/queue/event-queue.js';
import type { QueueName } from '../src/shared/queue/queue-name.js';

/**
 * Puts every job in one queue's failed set back to waiting.
 *
 *   npm run retry-failed -- <queue>
 *
 * The dashboard at /admin/queues retries one job at a time, which is the right
 * shape for one poisoned job and the wrong one for the hundred a bad deploy
 * leaves behind. There is no never-retry policy here on purpose: a job that
 * cannot succeed already terminates at `attempts` and stays in the set where a
 * human sees it, and a job whose promotion is gone is idempotent (ADR-0007).
 */
const [name] = process.argv.slice(2);
// The routing map is where a queue's name exists; a second list here would be a
// second place to forget.
const queues = [...new Set(Object.values(eventRouting))];

if (!queues.includes(name as QueueName)) {
  logger.error({ queues }, `name one queue: ${queues.join(', ')}`);
  process.exit(1);
}

const config = loadConfig();
const queue = EventQueue.connect(
  config.REDIS_URL,
  config.REDIS_QUEUE_DB,
  eventRegistry,
  eventRouting,
);

try {
  const retried = await queue.retryFailed(name as QueueName);
  logger.info({ queue: name, retried }, 'failed jobs returned to waiting');
} finally {
  await queue.close();
}
