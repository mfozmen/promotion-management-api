import { z } from 'zod';

/** The body of `POST /api/products`. */
export const createProductInput = z.strictObject({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  // Integer minor units, never a float: the case's money rule (ADR-0003).
  basePriceCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  stockQuantity: z.number().int().nonnegative().max(2_147_483_647),
});

export type CreateProduct = z.infer<typeof createProductInput>;
