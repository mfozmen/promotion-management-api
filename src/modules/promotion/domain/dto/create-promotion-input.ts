import { z } from 'zod';

/** `productId` and `category` are both optional and at most one may be given: neither means a draft, one means an active promotion, and both is the contradiction the table's own check rejects. */
export const createPromotionInput = z
  .strictObject({
    name: z.string().trim().min(1).max(200),
    discountType: z.enum(['percentage', 'fixed']),
    value: z.number().int().positive().max(2_147_483_647),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    productId: z.number().int().positive().optional(),
    category: z.string().trim().min(1).max(100).optional(),
  })
  .refine((input) => input.productId === undefined || input.category === undefined, {
    message: 'a promotion targets one product or one category, never both',
    path: ['category'],
  })
  .refine((input) => input.discountType !== 'percentage' || input.value <= 10_000, {
    message: 'a percentage discount is at most 10000 basis points',
    path: ['value'],
  })
  .refine((input) => new Date(input.endsAt) > new Date(input.startsAt), {
    message: 'endsAt is after startsAt',
    path: ['endsAt'],
  })
  .refine((input) => new Date(input.endsAt) > new Date(), {
    message: 'endsAt is in the future',
    path: ['endsAt'],
  });

export type CreatePromotion = z.infer<typeof createPromotionInput>;
