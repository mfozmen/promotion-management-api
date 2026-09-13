import { z } from 'zod';

/** Announced per batch, so the cap is the ingestion batch size an import may emit at once. */
export const productUpserted = z.strictObject({
  productIds: z.array(z.number().int().positive()).min(1).max(5000),
});

export type ProductUpserted = z.infer<typeof productUpserted>;
