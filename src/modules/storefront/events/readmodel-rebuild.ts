import { z } from 'zod';

/** The category becomes a `SCAN` prefix, so it is trimmed and never blank. */
export const readModelRebuild = z.strictObject({
  category: z.string().trim().min(1).optional(),
});

export type ReadModelRebuild = z.infer<typeof readModelRebuild>;
