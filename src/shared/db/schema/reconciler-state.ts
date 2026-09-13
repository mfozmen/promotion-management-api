import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, timestamp } from 'drizzle-orm/pg-core';

export const reconcilerState = pgTable(
  'reconciler_state',
  {
    id: boolean('id').primaryKey().default(true),
    lastBoundarySweepAt: timestamp('last_boundary_sweep_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [check('reconciler_state_single_row_check', sql`${table.id}`)],
);
