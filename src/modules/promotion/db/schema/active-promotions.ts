import { sql } from 'drizzle-orm';
import { pgView } from 'drizzle-orm/pg-core';
import { promotions } from './promotions.js';

// The one place "is this promotion live" is decided, and it is decided on the
// database clock. Read paths select from here instead of repeating the predicate.
export const activePromotions = pgView('active_promotions').as((qb) =>
  qb
    .select()
    .from(promotions)
    .where(
      sql`${promotions.status} = 'active' and tstzrange(${promotions.startsAt}, ${promotions.endsAt}) @> now()`,
    ),
);
