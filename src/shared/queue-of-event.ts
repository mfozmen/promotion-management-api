import type { EventName } from './event-name.js';
import type { QueueName } from './queue-name.js';

/**
 * Which queue carries each event.
 *
 * Ingestion has its own queue so a chunk backlog cannot delay a promotion
 * boundary. It does not isolate everything an import produces: `product.upserted`
 * is announced on `events`, so a 500 000-row import's announcements queue behind
 * the same consumer as a flash sale's `promotion.changed`. Whether that becomes a
 * per-publish queue argument or a job priority is an open owner decision.
 */
export const queueOfEvent = {
  'product.upserted': 'events',
  'promotion.changed': 'events',
  'readmodel.rebuild': 'events',
  'reconcile.run': 'events',
  'ingestion.chunk': 'ingestion',
} as const satisfies Record<EventName, QueueName>;
