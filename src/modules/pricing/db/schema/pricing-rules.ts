import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { pricingRuleType } from './pricing-rule-type.js';

export const pricingRules = pgTable(
  'pricing_rules',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    type: pricingRuleType('type').notNull(),
    name: text('name').notNull().unique(),
    conditions: jsonb('conditions').notNull(),
    event: jsonb('event').notNull(),
    priority: integer('priority').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Serves the loader: one layer's rules, highest priority first.
    index('pricing_rules_active_idx')
      .on(table.type, table.priority.desc())
      .where(sql`${table.active}`),
  ],
);
