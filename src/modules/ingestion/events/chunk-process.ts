import { z } from 'zod';

export const chunkProcess = z.strictObject({
  jobId: z.number().int().positive(),
  chunkIndex: z.number().int().nonnegative(),
});

export type ChunkProcess = z.infer<typeof chunkProcess>;
