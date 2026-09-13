import { z } from 'zod';

export type VendorRowFacts = {
  category: string;
  vendorPriceCents: number;
  stockQuantity: number;
};

/** Re-validated: `BigInt()` throws on a fractional price and a missing fact skips a rule silently. */
export const vendorRowFacts = z.object({
  // Trimmed before matching: a padded category would price as a different category.
  category: z.string().trim().min(1),
  vendorPriceCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  stockQuantity: z.number().int().min(0),
});
