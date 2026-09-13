import { z } from 'zod';

export const promotionChanged = z.strictObject({
  promotionId: z.number().int().positive(),
});

export type PromotionChanged = z.infer<typeof promotionChanged>;
