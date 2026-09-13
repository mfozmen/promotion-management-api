import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { hasSqlState } from '../../../shared/db/has-sql-state.js';
import { SqlState } from '../../../shared/db/sql-state.js';
import { promotions } from './schema/promotions.js';
import type { AssignPromotion } from '../domain/dto/assign-promotion-schema.js';
import { promotionColumns } from './promotion-columns.js';
import { databaseNow } from './database-now.js';
import type { PromotionWriteOutcome } from '../domain/dto/promotion-write-outcome.js';

/**
 * One guarded `UPDATE`: the target is set and the status becomes `active` only
 * where the row is still a draft whose window has not passed. A concurrent
 * assign loses because the second one matches no row, and an expired draft
 * cannot be woken — both decided on the database clock, in the statement that
 * does the work rather than in a read before it.
 */
export async function assignPromotion(
  db: Db,
  id: number,
  target: AssignPromotion,
): Promise<PromotionWriteOutcome> {
  try {
    const [row] = await db
      .update(promotions)
      .set({
        productId: target.productId ?? null,
        category: target.category ?? null,
        status: 'active',
      })
      .where(
        and(
          eq(promotions.id, id),
          eq(promotions.status, 'draft'),
          sql`${promotions.endsAt} > now()`,
        ),
      )
      .returning({ ...promotionColumns, now: databaseNow });

    if (row) {
      const { now, ...promotion } = row;
      return { ok: true, now: new Date(now), promotion };
    }

    const [existing] = await db
      .select({ id: promotions.id })
      .from(promotions)
      .where(eq(promotions.id, id))
      .limit(1);
    return existing ? { ok: false, reason: 'not-assignable' } : { ok: false, reason: 'not-found' };
  } catch (error) {
    // A productId naming no product is an admin's typo, not a server fault: the
    // foreign key rejects it and the route answers 404 rather than paging someone.
    if (hasSqlState(error, SqlState.foreignKeyViolation))
      return { ok: false, reason: 'no-such-product' };
    if (!hasSqlState(error, SqlState.exclusionViolation)) throw error;
    return { ok: false, reason: 'overlap' };
  }
}
