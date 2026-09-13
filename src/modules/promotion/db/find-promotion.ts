import { eq } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { promotions } from '../../../shared/db/schema.js';
import type { PromotionView } from '../domain/promotion-view.js';
import { promotionColumns } from './promotion-columns.js';

export async function findPromotion(db: Db, id: number): Promise<PromotionView | null> {
  const [row] = await db
    .select(promotionColumns)
    .from(promotions)
    .where(eq(promotions.id, id))
    .limit(1);
  return row ?? null;
}
