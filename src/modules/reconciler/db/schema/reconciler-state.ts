import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, timestamp } from 'drizzle-orm/pg-core';

export const reconcilerState = pgTable(
  'reconciler_state',
  {
    id: boolean('id').primaryKey().default(true),
    // Milliseconds, not the default microseconds: the sweep advances this mark by
    // compare-and-set against the value it read back as a JS Date, and a Date cannot
    // carry the microseconds `now()` writes, so the equality never matched.
    lastBoundarySweepAt: timestamp('last_boundary_sweep_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [check('reconciler_state_single_row_check', sql`${table.id}`)],
);
