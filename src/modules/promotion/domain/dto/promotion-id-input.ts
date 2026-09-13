import { z } from 'zod';

/** Digits only, for the reason the storefront gives: `z.coerce` accepts `0x2a`
 *  and `4.2e1` as 42, and `1e20` reaches a `bigint` column where PostgreSQL
 *  raises 22003 and the request ends as a 500 (REVIEW.md 8.2). */
export const promotionIdInput = z.strictObject({
  id: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1)),
});

export type PromotionIdInput = z.infer<typeof promotionIdInput>;
