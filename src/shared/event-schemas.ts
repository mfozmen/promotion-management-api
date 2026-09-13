import { z } from 'zod';

const entityId = z.number().int().positive();

/**
 * The event catalogue: section 6 of the domain design spec. Payloads are strict,
 * so a field has to be added here before it can cross the queue boundary.
 */
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
