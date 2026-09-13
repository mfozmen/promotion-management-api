import { z } from 'zod';

/**
 * The body of `POST /api/products`. Strict, so an unknown field is a `400`
 * rather than a silently dropped one (ADR-0008).
 *
 * Every bound here also exists in the database — `sku` is unique, price and
 * stock are `CHECK (>= 0)` — because a boundary that agrees with the schema is
 * a better error message, not a substitute for the constraint (REVIEW.md 2b).
 */
export const createProductSchema = z.strictObject({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  // Integer minor units, never a float: the case's money rule (ADR-0003).
  basePriceCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  stockQuantity: z.number().int().nonnegative().max(2_147_483_647),
});

export type CreateProduct = z.infer<typeof createProductSchema>;
