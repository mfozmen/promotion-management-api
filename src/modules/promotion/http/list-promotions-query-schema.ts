import { z } from 'zod';

/**
 * `status` is the stored value, not the derived state: filtering on `live`
 * would be a time predicate, and those belong in SQL rather than in a query
 * string the caller composes (REVIEW.md 2.7).
 */
export const listPromotionsQuerySchema = z.strictObject({
  status: z.enum(['draft', 'active', 'cancelled']).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  productId: z.coerce.number().int().positive().optional(),
});

export type ListPromotionsQuery = z.infer<typeof listPromotionsQuerySchema>;
