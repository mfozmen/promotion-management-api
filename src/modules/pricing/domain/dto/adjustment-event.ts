import { z } from 'zod';

/** -10 000 basis points already makes the price zero; beyond it is always negative. */
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
