import { sql } from 'drizzle-orm';
import { pgView } from 'drizzle-orm/pg-core';
import { promotions } from './promotions.js';

export const activePromotions = pgView('active_promotions').as((qb) =>
  qb
    .select()
    .from(promotions)
    .where(
      sql`${promotions.status} = 'active' and tstzrange(${promotions.startsAt}, ${promotions.endsAt}) @> now()`,
    ),
);
