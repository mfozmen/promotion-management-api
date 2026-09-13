import { z } from 'zod';

/** A product as the read model holds it. Redis stores strings, so the hash is
 *  coerced rather than trusted: an entry missing a field is a bug in the
 *  writer, and a 500 the operator sees beats a product priced at zero. */
export const storedProduct = z.object({
  id: z.coerce.number().int(),
  sku: z.string(),
  name: z.string(),
  category: z.string(),
  basePriceCents: z.coerce.number().int(),
  effectivePriceCents: z.coerce.number().int(),
  stockQuantity: z.coerce.number().int(),
  promotionId: z.coerce.number().int().optional(),
  // Defaulted rather than optional: the writer writes the pair together, and a
  // missing display name is cosmetic where a missing price is not.
  promotionName: z.string().default(''),
});

export type StoredProduct = z.infer<typeof storedProduct>;
