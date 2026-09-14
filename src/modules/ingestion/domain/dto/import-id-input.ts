import { z } from 'zod';

/** Digits only: `z.coerce` takes `1e20`, which reaches `bigint` as a 22003 and a 500. */
export const importIdInput = z.strictObject({
  id: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1)),
});

export type ImportIdInput = z.infer<typeof importIdInput>;
