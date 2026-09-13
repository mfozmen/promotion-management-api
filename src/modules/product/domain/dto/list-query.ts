import { z } from 'zod';
import { MAX_CATEGORY } from './max-category.js';
import { MAX_OFFSET } from './max-offset.js';
import { MAX_PAGE_SIZE } from './max-page-size.js';

/** Digits only rather than `z.coerce`: `1e9` and `0x10` are numbers to
 *  JavaScript, and a page of `1e9` is the deep scan `MAX_OFFSET` refuses. */
const digits = (max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(max));

export const listQuery = z
  .strictObject({
    // Bounded because it becomes a Redis key on the busiest path in the system,
    // and its length is the caller's to choose.
    category: z.string().min(1).max(MAX_CATEGORY).optional(),
    // One sort exists, and naming it is how a client asks for the default rather
    // than discovering later that the parameter was ignored.
    sort: z.literal('effectivePrice').optional(),
    order: z.enum(['asc', 'desc']).default('asc'),
    page: digits(Number.MAX_SAFE_INTEGER).default(1),
    pageSize: digits(MAX_PAGE_SIZE).default(20),
  })
  .refine(({ page, pageSize }) => (page - 1) * pageSize <= MAX_OFFSET, {
    message: `page is too deep; the offset may not exceed ${MAX_OFFSET}`,
    path: ['page'],
  });

export type ListQuery = z.infer<typeof listQuery>;
