import { sql } from 'drizzle-orm';
import { bigint, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { products } from './products.js';
import { promotionDiscountType } from './promotion-discount-type.js';
import { promotionStatus } from './promotion-status.js';

export const promotions = pgTable(
  'promotions',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    name: text('name').notNull(),
    discountType: promotionDiscountType('discount_type').notNull(),
    // Basis points for 'percentage', minor units for 'fixed'. integer, not bigint: a fixed
    // discount therefore tops out well below base_price_cents, which is harmless because a
    // discount above the base clamps to zero anyway.
    value: integer('value').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    productId: bigint('product_id', { mode: 'number' }).references(() => products.id),
    category: text('category'),
    status: promotionStatus('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => [
    check('promotions_window_check', sql`${table.endsAt} > ${table.startsAt}`),
    check('promotions_value_check', sql`${table.value} > 0`),
    // 10 000 basis points is a free product; beyond it the price would go negative.
    check(
      'promotions_percentage_value_check',
      sql`${table.discountType} <> 'percentage' or ${table.value} <= 10000`,
    ),
    check(
      'promotions_active_target_check',
      sql`${table.status} <> 'active' or (${table.productId} is null) <> (${table.category} is null)`,
    ),
    check(
      'promotions_draft_target_check',
      sql`${table.status} <> 'draft' or (${table.productId} is null and ${table.category} is null)`,
    ),
  ],
);
