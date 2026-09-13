import { z } from 'zod';

/** Generous rather than tight: the column it filters is unbounded text, so a
 *  bound a real category could reach would refuse the one a sale runs on. */
const MAX_CATEGORY = 256;
const MAX_PAGE_SIZE = 100;
/** Redis walks an offset member by member, so the depth is bounded here rather
 *  than discovered as a slow request (ADR-0006). */
const MAX_OFFSET = 10_000;

/** Digits only rather than `z.coerce`: `1e9` and `0x10` are numbers to
 *  JavaScript, and a page of `1e9` is the deep scan `MAX_OFFSET` refuses. */
const digits = (max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(max));

export const listQuery = z
  .strictObject({
    category: z.string().min(1).max(MAX_CATEGORY).optional(),
    // One sort exists, and naming it is how a client asks for the default rather
    // than discovering later that the parameter was ignored.
    sort: z.literal('effectivePrice').optional(),
    order: z.enum(['asc', 'desc']).default('asc'),
    page: digits(Number.MAX_SAFE_INTEGER).default(1),
    pageSize: digits(MAX_PAGE_SIZE).default(20),
  })
  // No message: the validator discards a schema's own wording (ADR-0009).
  .refine(({ page, pageSize }) => (page - 1) * pageSize <= MAX_OFFSET);

export type ListQuery = z.infer<typeof listQuery>;
