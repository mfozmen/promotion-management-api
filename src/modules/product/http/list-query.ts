import { z } from 'zod';
import { MAX_PAGE_SIZE } from './max-page-size.js';

export const listQuery = z.strictObject({
  category: z.string().min(1).optional(),
  // One sort exists, and naming it is how a client asks for the default rather
  // than discovering later that the parameter was ignored.
  sort: z.literal('effectivePrice').optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export type ListQuery = z.infer<typeof listQuery>;
