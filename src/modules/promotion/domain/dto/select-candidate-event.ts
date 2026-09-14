import { z } from 'zod';

/** A rule names the winner and nothing else: the arithmetic is the calculator's,
 *  so a rule can never carry a price or a discount of its own. */
export const selectCandidateEvent = z.strictObject({
  type: z.literal('selectCandidate'),
  params: z.strictObject({ level: z.enum(['product', 'category']) }),
});
