import { z } from 'zod';

export const ingestionChunk = z.strictObject({
  jobId: z.number().int().positive(),
  chunkIndex: z.number().int().nonnegative(),
});

export type IngestionChunk = z.infer<typeof ingestionChunk>;
