import { pgEnum } from 'drizzle-orm/pg-core';

export const promotionStatus = pgEnum('promotion_status', ['draft', 'active', 'cancelled']);
