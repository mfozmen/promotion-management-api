import { z } from 'zod';

/**
 * The event catalogue of section 6 of
 * `docs/superpowers/specs/2026-09-12-domain-design.md`. Producers and consumers
 * are written in parallel, so every payload is typed at compile time and parsed
 * at the queue boundary: a malformed job fails where it is produced rather than
 * deep inside a handler.
 *
 * Payloads are strict, so nothing rides along uninvited: a correlation id has to
 * be added to a schema here before it can cross the queue boundary.
 */

const entityId = z.number().int().positive();

export const eventSchemas = {
  'product.upserted': z.strictObject({ productIds: z.array(entityId).min(1).max(1000) }),
  'promotion.changed': z.strictObject({ promotionId: entityId }),
  // The category becomes a `SCAN` prefix, so it is trimmed and never blank.
  'readmodel.rebuild': z.strictObject({ category: z.string().trim().min(1).optional() }),
  'reconcile.run': z.strictObject({}),
  'ingestion.chunk': z.strictObject({
    jobId: entityId,
    chunkIndex: z.number().int().nonnegative(),
  }),
} as const;

export type EventName = keyof typeof eventSchemas;
export type EventPayload<N extends EventName> = z.infer<(typeof eventSchemas)[N]>;

export type QueueName = 'events' | 'ingestion';

/** Ingestion has its own queue so a 500 000-row import cannot starve promotion events. */
export const queueOfEvent = {
  'product.upserted': 'events',
  'promotion.changed': 'events',
  'readmodel.rebuild': 'events',
  'reconcile.run': 'events',
  'ingestion.chunk': 'ingestion',
} as const satisfies Record<EventName, QueueName>;

export function parseEvent<N extends EventName>(name: N, payload: unknown): EventPayload<N> {
  return eventSchemas[name].parse(payload) as EventPayload<N>;
}
