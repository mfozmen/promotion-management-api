import { z } from 'zod';

/** A product as the read model holds it. Redis stores strings, so the hash is
 *  coerced rather than trusted: an entry missing a field is a bug in the
 *  writer, and a 500 the operator sees beats a product priced at zero. */
export const storedProduct = z
  .object({
    id: z.coerce.number().int(),
    sku: z.string(),
    name: z.string(),
    category: z.string(),
    basePriceCents: z.coerce.number().int(),
    effectivePriceCents: z.coerce.number().int(),
    stockQuantity: z.coerce.number().int(),
    promotionId: z.coerce.number().int().optional(),
    promotionName: z.string().min(1).optional(),
  })
  // Both or neither: the writer writes the pair together, so half a pair is a
  // bug in it. A name defaulted to empty renders a discount attributed to a
  // promotion with no title, and a name without an id names a discount that
  // nothing gave.
  .refine(
    ({ promotionId, promotionName }) =>
      (promotionId === undefined) === (promotionName === undefined),
    { message: 'a stored promotion needs both an id and a name' },
  );

export type StoredProduct = z.infer<typeof storedProduct>;
