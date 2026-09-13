import { z } from 'zod';

/** Assigning names exactly one target: a draft with neither is still a draft. */
export const assignPromotionSchema = z
  .strictObject({
    productId: z.number().int().positive().optional(),
    category: z.string().trim().min(1).max(100).optional(),
  })
  .refine((input) => (input.productId === undefined) !== (input.category === undefined), {
    message: 'assign names exactly one of productId or category',
    path: ['category'],
  });

export type AssignPromotion = z.infer<typeof assignPromotionSchema>;
