import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { products } from '../../../product/db/schema/products.js';
import { promotionDiscountType } from './promotion-discount-type.js';
import { promotionStatus } from './promotion-status.js';

export const promotions = pgTable(
  'promotions',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    name: text('name').notNull(),
    discountType: promotionDiscountType('discount_type').notNull(),
    // basis points for 'percentage', minor units for 'fixed'
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
    // The two GiST exclusion indexes are partial on `status = 'active'`, so the
    // admin list's filters cannot use them: `?productId=` on a cancelled row, or
    // `?status=draft`, scans the heap without these. `product_id` is also a
    // foreign key, which PostgreSQL does not index for you.
    index('promotions_product_id_idx').on(table.productId, table.id),
    index('promotions_category_id_idx').on(table.category, table.id),
    check('promotions_window_check', sql`${table.endsAt} > ${table.startsAt}`),
    check('promotions_value_check', sql`${table.value} > 0`),
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
