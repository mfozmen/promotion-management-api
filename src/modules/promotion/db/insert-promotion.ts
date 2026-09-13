import { sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { isExclusionViolation } from '../../../shared/db/exclusion-violation.js';
import { promotions } from '../../../shared/db/schema.js';
import { promotionColumns } from './promotion-columns.js';
import type { CreatePromotion } from '../http/create-promotion-schema.js';
import { findConflictingPromotion } from './find-conflicting-promotion.js';
import type { PromotionWriteOutcome } from './promotion-write-outcome.js';

/**
 * A promotion with a target is born `active`; one without is a `draft`, which
 * the target checks on the table already require.
 *
 * The overlap is decided by the two GiST exclusion constraints, never by
 * reading first and inserting after: two admins creating the same window at
 * once both pass that read (REVIEW.md 3.1). `now` comes back from the same
 * statement so the boundaries are scheduled against the clock that stored them.
 */
export async function insertPromotion(
  db: Db,
  input: CreatePromotion,
): Promise<PromotionWriteOutcome & { now?: Date }> {
  const hasTarget = input.productId !== undefined || input.category !== undefined;
  try {
    const [row] = await db
      .insert(promotions)
      .values({
        name: input.name,
        discountType: input.discountType,
        value: input.value,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        productId: input.productId ?? null,
        category: input.category ?? null,
        status: hasTarget ? 'active' : 'draft',
      })
      .returning({ ...promotionColumns, now: sql<Date>`now()` });
    if (!row) throw new Error('insert returned no row');

    const { now, ...promotion } = row;
    return { ok: true, now, promotion };
  } catch (error) {
    if (!isExclusionViolation(error)) throw error;
    return {
      ok: false,
      reason: 'overlap',
      conflictingPromotionId: await findConflictingPromotion(
        db,
        { productId: input.productId, category: input.category },
        { startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt) },
      ),
    };
  }
}
