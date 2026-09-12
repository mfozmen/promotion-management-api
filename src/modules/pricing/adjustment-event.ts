import { z } from 'zod';

/** A percentage adjustment stops at -10 000 basis points, which already makes
 *  the price zero: anything beyond it can only produce a negative price, so it
 *  is rejected once at compile time rather than row by row. */
export const adjustmentEvent = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('adjustPercentBps'),
    params: z.strictObject({ value: z.number().int().min(-10_000) }),
  }),
  z.strictObject({
    type: z.literal('adjustCents'),
    params: z.strictObject({ value: z.number().int() }),
  }),
]);

export type AdjustmentEvent = z.infer<typeof adjustmentEvent>;
