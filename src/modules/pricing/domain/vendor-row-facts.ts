import { z } from 'zod';

export type VendorRowFacts = {
  category: string;
  vendorPriceCents: number;
  stockQuantity: number;
};

/** The chunk processor validates its rows too, but a wrapper that promises
 *  never to throw cannot take that on trust: `BigInt()` throws on a fractional
 *  or NaN price, and a missing fact makes the engine either throw or evaluate
 *  the condition false and skip the rule with no trace in the result. */
export const vendorRowFacts = z.object({
  // Trimmed before it is matched: comparing a padded category untrimmed prices
  // the row as if it were another category. Nothing but spaces is unusable.
  category: z.string().trim().min(1),
  vendorPriceCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  stockQuantity: z.number().int().min(0),
});
