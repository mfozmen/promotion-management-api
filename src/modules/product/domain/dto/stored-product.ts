import { z } from 'zod';

/** Redis answers strings, and `z.coerce.number()` is not a parser: it reads ''
 *  and ' ' as 0, '0x10' as 16, and would have served a product for nothing at
 *  200. Digits only, then the number. */
const blankIsAbsent = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const cents = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().max(Number.MAX_SAFE_INTEGER));

/** A product as the read model holds it. Redis stores strings, so the hash is
 *  coerced rather than trusted: an entry missing a field is a bug in the
 *  writer, and a 500 the operator sees beats a product priced at zero. */
export const storedProduct = z
  .object({
    id: cents,
    sku: z.string(),
    name: z.string(),
    category: z.string(),
    basePriceCents: cents,
    effectivePriceCents: cents,
    stockQuantity: cents,
    // Absent or empty, both meaning no promotion: Redis has no null, and
    // ioredis writes both `null` and `undefined` into a hash as ''. A writer
    // building this from a row whose promotion columns are NULL emits '', and
    // refusing it would fail every product without a promotion — on a listing,
    // the whole page. A price has no such spelling and stays strict.
    promotionId: z.preprocess(blankIsAbsent, cents.optional()),
    promotionName: z.preprocess(blankIsAbsent, z.string().optional()),
  })
  // Both or neither: the writer writes the pair together, so half a pair is a
  // bug in it. A name that is empty or only spaces renders a discount
  // attributed to a promotion with no title, and a name without an id names a
  // discount that nothing gave.
  .refine(
    ({ promotionId, promotionName }) =>
      (promotionId === undefined) === (promotionName === undefined),
    { message: 'a stored promotion needs both an id and a name' },
  )
  // REVIEW.md 1.5 holds on the way out as well as on the way in: a promotion
  // lowers a price, so an effective price above its base is the writer having
  // computed one wrong, and a storefront that renders it has sold at it.
  .refine(({ basePriceCents, effectivePriceCents }) => effectivePriceCents <= basePriceCents, {
    message: 'an effective price cannot exceed the base price it came from',
  });
