import type { QueueName } from '../shared/queue/queue-name.js';
import type { EventName } from './event-name.js';

/** Which queue carries each event. The partition and its reason: ADR-0003. */
export const routing = {
  'promotion.changed': 'promotions',
  'product.upserted': 'catalog',
  'ingestion.chunk': 'ingestion',
  'readmodel.rebuild': 'maintenance',
  'reconcile.run': 'maintenance',
} as const satisfies Record<EventName, QueueName>;
