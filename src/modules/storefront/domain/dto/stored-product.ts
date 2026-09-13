import { z } from 'zod';

/** Digits only: `z.coerce.number()` reads '' as 0 and '0x10' as 16. */
const blankIsAbsent = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const digits = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int());

/** A product as the read model holds it, parsed rather than trusted (ADR-0006). */
export const storedProduct = z
  .object({
    id: digits,
    sku: z.string(),
    name: z.string(),
    category: z.string(),
    basePriceCents: digits,
    effectivePriceCents: digits,
    stockQuantity: digits,
    // Absent or empty both mean no promotion (ADR-0006).
    promotionId: z.preprocess(blankIsAbsent, digits.optional()),
    promotionName: z.preprocess(blankIsAbsent, z.string().optional()),
  })
  // ADR-0006.
  .refine(
    ({ promotionId, promotionName }) =>
      (promotionId === undefined) === (promotionName === undefined),
    { message: 'a stored promotion needs both an id and a name' },
  )
  .refine(({ basePriceCents, effectivePriceCents }) => effectivePriceCents <= basePriceCents, {
    message: 'an effective price cannot exceed the base price it came from',
  })
  // ADR-0006: the recompute derives the promotion and the price together.
  .refine(
    ({ promotionId, basePriceCents, effectivePriceCents }) =>
      promotionId !== undefined || effectivePriceCents === basePriceCents,
    { message: 'a discounted price must name the promotion that made it' },
  );
