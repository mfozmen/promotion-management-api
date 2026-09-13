import { and, eq, gt, ne, sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { hasSqlState } from '../../../shared/db/has-sql-state.js';
import { SqlState } from '../../../shared/db/sql-state.js';
import { promotions } from './schema/promotions.js';
import type { PromotionState } from '../domain/dto/promotion-state.js';
import type { PromotionView } from '../domain/dto/promotion-view.js';
import type { PromotionWriteOutcome } from '../domain/dto/promotion-write-outcome.js';
import type { CancelPromotionOutcome } from '../domain/dto/cancel-promotion-outcome.js';
import type { AssignPromotion } from '../domain/dto/assign-promotion-input.js';
import type { CreatePromotion } from '../domain/dto/create-promotion-input.js';
import type { ListPromotionsInput } from '../domain/dto/list-promotions-input.js';

// The arm order is the definition: cancelled outranks any window.
const state = sql<PromotionState>`
  case
    when ${promotions.status} = 'cancelled' then 'cancelled'
    when ${promotions.status} = 'draft' then 'draft'
    when ${promotions.startsAt} > now() then 'scheduled'
    when ${promotions.endsAt} <= now() then 'expired'
    else 'live'
  end`;

// A raw fragment has no column mapper, so this is the driver's text, not a Date.
const committedAt = sql<string>`now()`;

const columns = {
  id: promotions.id,
  name: promotions.name,
  discountType: promotions.discountType,
  value: promotions.value,
  startsAt: promotions.startsAt,
  endsAt: promotions.endsAt,
  productId: promotions.productId,
  category: promotions.category,
  status: promotions.status,
  state,
} as const;

export class PromotionRepository {
  constructor(private readonly db: Db) {}

  async insert(input: CreatePromotion): Promise<PromotionWriteOutcome> {
    const hasTarget = input.productId !== undefined || input.category !== undefined;
    try {
      const rows = await this.db
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
        .returning({ ...columns, now: committedAt });
      // One row or a throw, so the result is read as the one-tuple it is.
      const [row] = rows as [(typeof rows)[number]];
      const { now, ...promotion } = row;

      return { ok: true, now: new Date(now), promotion };
    } catch (error) {
      if (hasSqlState(error, SqlState.foreignKeyViolation)) {
        return { ok: false, reason: 'no-such-product' };
      }
      if (!hasSqlState(error, SqlState.exclusionViolation)) throw error;

      return { ok: false, reason: 'overlap' };
    }
  }

  async assign(id: number, target: AssignPromotion): Promise<PromotionWriteOutcome> {
    try {
      const [row] = await this.db
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
        .returning({ ...columns, now: committedAt });

      if (row) {
        const { now, ...promotion } = row;

        return { ok: true, now: new Date(now), promotion };
      }

      const [existing] = await this.db
        .select({ id: promotions.id })
        .from(promotions)
        .where(eq(promotions.id, id))
        .limit(1);

      return existing
        ? { ok: false, reason: 'not-assignable' }
        : { ok: false, reason: 'not-found' };
    } catch (error) {
      if (hasSqlState(error, SqlState.foreignKeyViolation)) {
        return { ok: false, reason: 'no-such-product' };
      }
      if (!hasSqlState(error, SqlState.exclusionViolation)) throw error;

      return { ok: false, reason: 'overlap' };
    }
  }

  async cancel(id: number): Promise<CancelPromotionOutcome> {
    const [cancelled] = await this.db
      .update(promotions)
      .set({ status: 'cancelled', cancelledAt: sql`now()` })
      .where(and(eq(promotions.id, id), ne(promotions.status, 'cancelled')))
      .returning(columns);

    if (cancelled) return { ok: true, promotion: cancelled, changed: true };

    const [already] = await this.db
      .select(columns)
      .from(promotions)
      .where(eq(promotions.id, id))
      .limit(1);

    return already
      ? { ok: true, promotion: already, changed: false }
      : { ok: false, reason: 'not-found' };
  }

  async find(id: number): Promise<PromotionView | undefined> {
    const [row] = await this.db
      .select(columns)
      .from(promotions)
      .where(eq(promotions.id, id))
      .limit(1);

    return row;
  }

  list(filters: ListPromotionsInput): Promise<PromotionView[]> {
    const conditions = [
      filters.status === undefined ? undefined : eq(promotions.status, filters.status),
      filters.category === undefined ? undefined : eq(promotions.category, filters.category),
      filters.productId === undefined ? undefined : eq(promotions.productId, filters.productId),
      filters.after === undefined ? undefined : gt(promotions.id, filters.after),
    ].filter((condition) => condition !== undefined);

    return this.db
      .select(columns)
      .from(promotions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(promotions.id)
      .limit(filters.limit);
  }
}
