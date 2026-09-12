import { z } from 'zod';

/**
 * The event catalogue of the design (section 6 of
 * `docs/superpowers/specs/2026-09-12-domain-design.md`). Producers and
 * consumers are written in parallel, so the payload of every event is typed at
 * compile time and validated with zod at the queue boundary: a malformed job is
 * rejected where it is produced, never deep inside a handler.
 *
 * Payloads are strict: an unknown field is rejected rather than ignored, so a
 * typo in a producer is visible (REVIEW.md 8.1). The correlation id of
 * REVIEW.md 10.1 therefore rides in the BullMQ job options, not in the payload;
 * adding it to a payload means adding it to that event's schema here first.
 */

const entityId = z.number().int().positive();

export const eventSchemas = {
  /** Recompute these products in the read model. At most 1 000 ids per job. */
  'product.upserted': z.strictObject({ productIds: z.array(entityId).min(1).max(1000) }),
  /** A promotion was created, assigned, cancelled, or crossed a boundary. */
  'promotion.changed': z.strictObject({ promotionId: entityId }),
  /** Rebuild the read model, scoped to one category when given. The category becomes a `SCAN` prefix, so it is trimmed and never blank. */
  'readmodel.rebuild': z.strictObject({ category: z.string().trim().min(1).optional() }),
  /** The reconciler sweep. Carries no payload. */
  'reconcile.run': z.strictObject({}),
  /** Process one chunk of a vendor file from its checkpoint. */
  'ingestion.chunk': z.strictObject({
    jobId: entityId,
    chunkIndex: z.number().int().nonnegative(),
  }),
} as const;

export type EventName = keyof typeof eventSchemas;
export type EventPayload<N extends EventName> = z.infer<(typeof eventSchemas)[N]>;

export type QueueName = 'events' | 'ingestion';

/** Which queue carries each event. Ingestion is separate so a 500 000-row import cannot starve promotion events. */
export const queueOfEvent = {
  'product.upserted': 'events',
  'promotion.changed': 'events',
  'readmodel.rebuild': 'events',
  'reconcile.run': 'events',
  'ingestion.chunk': 'ingestion',
} as const satisfies Record<EventName, QueueName>;

/** Validates a payload against its event schema, throwing `ZodError` when it does not match. */
export function parseEvent<N extends EventName>(name: N, payload: unknown): EventPayload<N> {
  return eventSchemas[name].parse(payload) as EventPayload<N>;
}
