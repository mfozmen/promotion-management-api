import { z } from 'zod';

/** `status` is the stored value, not the derived state: filtering on `live` would be a time predicate, and those belong in SQL rather than in a query string the caller composes. */
export const listPromotionsInput = z.strictObject({
  status: z.enum(['draft', 'active', 'cancelled']).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  productId: z.coerce.number().int().positive().optional(),
  // Keyset, not offset: the list is ordered by `id`, which never changes, so a
  // page cannot repeat or skip a row when a promotion is created mid-read
  // `after` is the last id of the previous page.
  after: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type ListPromotionsInput = z.infer<typeof listPromotionsInput>;
