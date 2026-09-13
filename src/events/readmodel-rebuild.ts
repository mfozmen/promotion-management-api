import { z } from 'zod';

/** The category becomes a `SCAN` prefix, so it is trimmed and never blank. */
export const readmodelRebuild = z.strictObject({
  category: z.string().trim().min(1).optional(),
});

export type ReadmodelRebuild = z.infer<typeof readmodelRebuild>;
