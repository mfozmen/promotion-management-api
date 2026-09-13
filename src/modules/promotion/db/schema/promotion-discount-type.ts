import { pgEnum } from 'drizzle-orm/pg-core';

export const promotionDiscountType = pgEnum('promotion_discount_type', ['percentage', 'fixed']);
