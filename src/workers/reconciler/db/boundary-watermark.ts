import { and, gt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { promotions } from '../../../modules/promotion/db/schema/promotions.js';
import { reconcilerState } from './schema/reconciler-state.js';

export class BoundaryWatermark {
  constructor(private readonly db: Db) {}

  /**
   * Both ends of the window come from one statement on the database clock. Asking
   * for `now()` again when the promotions are read would leave a gap between what
   * was looked at and what the watermark then claims was looked at, and a
   * promotion whose boundary falls in that gap is what a sweep exists to catch.
   */
  async crossedSince(): Promise<{ promotionIds: number[]; windowEnd: Date }> {
    // One row by construction: `reconciler_state` carries a single-row check.
    const [bounds] = await this.db
      .select({ since: reconcilerState.lastBoundarySweepAt, windowEnd: sql<string>`now()` })
      .from(reconcilerState);
    // `string`, not `Date`: a raw fragment has no column mapper, so it arrives as the
    // driver's text. Annotating it `Date` compiles and then fails at the first use
    // — the same trap ADR-0004 records for the write paths' `now()`.
    const { since, windowEnd } = bounds as { since: Date; windowEnd: string };
    const readAt = new Date(windowEnd);

    const rows = await this.db
      .select({ id: promotions.id })
      .from(promotions)
      // Half-open at both ends: `since` was covered by the sweep that set it and
      // `windowEnd` is covered by this one, so no boundary is read twice or missed.
      .where(
        or(
          and(gt(promotions.startsAt, since), lte(promotions.startsAt, readAt)),
          and(gt(promotions.endsAt, since), lte(promotions.endsAt, readAt)),
          and(gt(promotions.cancelledAt, since), lte(promotions.cancelledAt, readAt)),
        ),
      );

    // A promotion whose window opened and closed inside one sweep matches twice and
    // is announced once; its handler would recompute the same prices either way.
    return { promotionIds: [...new Set(rows.map((row) => Number(row.id)))], windowEnd: readAt };
  }

  async advanceWatermark(to: Date): Promise<void> {
    await this.db.update(reconcilerState).set({ lastBoundarySweepAt: to });
  }
}
