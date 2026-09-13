import { and, gt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { promotions } from '../../../modules/promotion/db/schema/promotions.js';
import { reconcilerState } from './schema/reconciler-state.js';

/**
 * The window and its end come from one statement on the database clock: a second
 * query for `now()` would leave a gap between what was read and what the watermark
 * claims was read, and the promotions in that gap are exactly the ones a sweep
 * exists to catch.
 */
export class BoundaryWatermark {
  constructor(private readonly db: Db) {}

  async crossedSince(): Promise<{ promotionIds: number[]; windowEnd: Date }> {
    const since = sql<string>`(select ${reconcilerState.lastBoundarySweepAt} from ${reconcilerState})`;
    const windowEnd = sql<string>`now()`;

    const rows = await this.db
      .select({ id: promotions.id, windowEnd })
      .from(promotions)
      // Half-open on both ends: `since` was covered by the sweep that set it, and
      // `now()` is covered by this one, so no boundary is read twice or skipped.
      .where(
        or(
          and(gt(promotions.startsAt, since), lte(promotions.startsAt, windowEnd)),
          and(gt(promotions.endsAt, since), lte(promotions.endsAt, windowEnd)),
          and(gt(promotions.cancelledAt, since), lte(promotions.cancelledAt, windowEnd)),
        ),
      );

    // A promotion whose window opened and closed inside one sweep matches twice and
    // is announced once; the handler would recompute the same prices either way.
    const promotionIds = [...new Set(rows.map((row) => Number(row.id)))];

    return { promotionIds, windowEnd: new Date(await this.readWindowEnd(rows)) };
  }

  async advanceWatermark(to: Date): Promise<void> {
    await this.db.update(reconcilerState).set({ lastBoundarySweepAt: to });
  }

  /**
   * An empty window carries no row to read `now()` from, so it is asked for on its
   * own — the only case where the instant does not come back beside the ids.
   */
  private async readWindowEnd(rows: { windowEnd: string }[]): Promise<string> {
    const first = rows[0];
    if (first !== undefined) return first.windowEnd;

    const [row] = await this.db.execute<{ now: string }>(sql`select now() as now`);

    return (row as { now: string }).now;
  }
}
