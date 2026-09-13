import { sql } from 'drizzle-orm';
import { promotions } from '../../../shared/db/schema.js';
import type { PromotionState } from '../domain/promotion-state.js';

/**
 * `state` as PostgreSQL decides it, for every read and every write's
 * `returning`. One expression, so no second copy can disagree with it and no
 * second clock can be consulted (REVIEW.md 2.7).
 *
 * The arm order is the definition: cancelled outranks any window, and a draft
 * has no window worth reporting because it has no target to apply to.
 */
export const promotionStateSql = sql<PromotionState>`
  case
    when ${promotions.status} = 'cancelled' then 'cancelled'
    when ${promotions.status} = 'draft' then 'draft'
    when ${promotions.startsAt} > now() then 'scheduled'
    when ${promotions.endsAt} <= now() then 'expired'
    else 'live'
  end`;
