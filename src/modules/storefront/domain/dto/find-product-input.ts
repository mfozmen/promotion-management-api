import { z } from 'zod';

/** Digits only: `z.coerce` would accept `0x2a` and `4.2e1` as product 42, so
 *  one product would answer on several URLs and fragment a cache in front of
 *  the busiest endpoint in the system. */
export const findProductInput = z.strictObject({
  id: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1)),
});

export type FindProductInput = z.infer<typeof findProductInput>;
