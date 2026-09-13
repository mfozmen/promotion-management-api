import { and, eq, gt } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { promotions } from './schema/promotions.js';
import type { PromotionView } from '../domain/dto/promotion-view.js';
import type { ListPromotionsQuery } from '../domain/dto/list-promotions-query-schema.js';
import { promotionColumns } from './promotion-columns.js';

/**
 * The admin list. It reads `promotions` rather than `active_promotions`,
 * because an admin screen has to show the draft, the scheduled and the expired
 * ones too; the view answers "running now", which is one of the five states
 * this returns.
 */
export function listPromotions(db: Db, filters: ListPromotionsQuery): Promise<PromotionView[]> {
  const conditions = [
    filters.status === undefined ? undefined : eq(promotions.status, filters.status),
    filters.category === undefined ? undefined : eq(promotions.category, filters.category),
    filters.productId === undefined ? undefined : eq(promotions.productId, filters.productId),
    filters.after === undefined ? undefined : gt(promotions.id, filters.after),
  ].filter((condition) => condition !== undefined);

  return db
    .select(promotionColumns)
    .from(promotions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(promotions.id)
    .limit(filters.limit);
}
