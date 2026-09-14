import { z } from 'zod';

export const selectCandidateEvent = z.strictObject({
  type: z.literal('selectCandidate'),
  params: z.strictObject({ level: z.enum(['product', 'category']) }),
});
