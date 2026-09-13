import { and, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { promotions } from './schema/promotions.js';
import { promotionColumns } from './promotion-columns.js';
import type { CancelPromotionOutcome } from '../domain/dto/cancel-promotion-outcome.js';

/**
 * Cancelling is idempotent, so a second call answers with the cancelled row
 * rather than a conflict: the caller asked for a state the row is already in.
 * The `ne` guard is what makes `cancelled_at` the first cancellation's instant
 * instead of the latest caller's.
 */
export async function cancelPromotion(db: Db, id: number): Promise<CancelPromotionOutcome> {
  const [cancelled] = await db
    .update(promotions)
    .set({ status: 'cancelled', cancelledAt: sql`now()` })
    .where(and(eq(promotions.id, id), ne(promotions.status, 'cancelled')))
    .returning(promotionColumns);

  if (cancelled) return { ok: true, promotion: cancelled, changed: true };

  const [already] = await db
    .select(promotionColumns)
    .from(promotions)
    .where(eq(promotions.id, id))
    .limit(1);
  return already
    ? { ok: true, promotion: already, changed: false }
    : { ok: false, reason: 'not-found' };
}
