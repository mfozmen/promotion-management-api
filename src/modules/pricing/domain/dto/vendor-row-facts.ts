import { z } from 'zod';

export type VendorRowFacts = {
  category: string;
  vendorPriceCents: number;
  stockQuantity: number;
};

/** Validated again here: a bad value must be a rejected row, not a throw. */
export const vendorRowFacts = z.object({
  category: z.string().trim().min(1),
  vendorPriceCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  stockQuantity: z.number().int().min(0),
});
