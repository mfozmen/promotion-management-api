import { and, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { promotions } from '../../../shared/db/schema.js';

/**
 * The active promotion whose window overlaps the one just rejected.
 *
 * Not a read of `active_promotions`: that view is `@> now()`, and the exclusion
 * constraints fire on any overlap between `status = 'active'` rows whether or
 * not either is running yet. Two sales scheduled for next week collide with
 * each other while the view holds neither of them.
 */
export async function findConflictingPromotion(
  db: Db,
  target: { productId?: number | null; category?: string | null },
  window: { startsAt: Date; endsAt: Date },
  excludeId?: number,
): Promise<number | null> {
  // `!== undefined`, not truthiness: a productId of 0 would otherwise fall to the
  // category branch and look up `category = null`. zod forbids 0 today, so this is
  // a trap rather than a live bug — and traps are what a later schema change trips.
  const matchesTarget =
    target.productId !== undefined && target.productId !== null
      ? eq(promotions.productId, target.productId)
      : eq(promotions.category, target.category as string);

  const [row] = await db
    .select({ id: promotions.id })
    .from(promotions)
    .where(
      and(
        eq(promotions.status, 'active'),
        matchesTarget,
        sql`tstzrange(${promotions.startsAt}, ${promotions.endsAt}) && tstzrange(${window.startsAt}, ${window.endsAt})`,
        excludeId === undefined ? undefined : ne(promotions.id, excludeId),
      ),
    )
    // Ordered, because `limit(1)` with no order lets the planner pick: an admin
    // whose window spans two active promotions would be told about one, cancel it,
    // retry, and be told about the other.
    .orderBy(promotions.startsAt, promotions.id)
    .limit(1);

  return row?.id ?? null;
}
