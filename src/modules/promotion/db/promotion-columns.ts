import { promotions } from '../../../shared/db/schema.js';
import { promotionStateSql } from './promotion-state-sql.js';

/** The columns every promotion read and write returns. */
export const promotionColumns = {
  id: promotions.id,
  name: promotions.name,
  discountType: promotions.discountType,
  value: promotions.value,
  startsAt: promotions.startsAt,
  endsAt: promotions.endsAt,
  productId: promotions.productId,
  category: promotions.category,
  status: promotions.status,
  state: promotionStateSql,
} as const;
