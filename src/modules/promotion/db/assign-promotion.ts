import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { isExclusionViolation } from '../../../shared/db/exclusion-violation.js';
import { isForeignKeyViolation } from '../../../shared/db/foreign-key-violation.js';
import { promotions } from './schema/promotions.js';
import type { AssignPromotion } from '../domain/dto/assign-promotion-schema.js';
import { findConflictingPromotion } from './find-conflicting-promotion.js';
import { promotionColumns } from './promotion-columns.js';
import type { PromotionWriteOutcome } from '../domain/dto/promotion-write-outcome.js';

/**
 * One guarded `UPDATE`: the target is set and the status becomes `active` only
 * where the row is still a draft whose window has not passed. A concurrent
 * assign loses because the second one matches no row, and an expired draft
 * cannot be woken — both decided on the database clock, in the statement that
 * does the work rather than in a read before it (REVIEW.md 2.7, 3.1).
 */
export async function assignPromotion(
  db: Db,
  id: number,
  target: AssignPromotion,
): Promise<PromotionWriteOutcome & { now?: Date }> {
  try {
    const [row] = await db
      .update(promotions)
      .set({ productId: target.productId ?? null, category: target.category ?? null, status: 'active' })
      .where(
        and(
          eq(promotions.id, id),
          eq(promotions.status, 'draft'),
          sql`${promotions.endsAt} > now()`,
        ),
      )
      .returning({ ...promotionColumns, now: sql<Date>`now()` });

    if (row) {
      const { now, ...promotion } = row;
      return { ok: true, now, promotion };
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
    if (isForeignKeyViolation(error)) return { ok: false, reason: 'no-such-product' };
    if (!isExclusionViolation(error)) throw error;
    const [window] = await db
      .select({ startsAt: promotions.startsAt, endsAt: promotions.endsAt })
      .from(promotions)
      .where(eq(promotions.id, id))
      .limit(1);
    return {
      ok: false,
      reason: 'overlap',
      conflictingPromotionId: window
        ? await findConflictingPromotion(db, target, window, id)
        : null,
    };
  }
}
