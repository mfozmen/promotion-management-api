import { and, asc, eq, gt, lte, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { promotions } from '../../promotion/db/schema/promotions.js';
import type { BoundaryWindow } from '../domain/dto/boundary-window.js';
import { reconcilerState } from './schema/reconciler-state.js';

/** Above the two 10 s timeouts in `shared/db/client.ts`, which bound how long a
 *  writer can hold a boundary uncommitted. */
const COMMIT_LAG_SECONDS = 30;

export class BoundaryRepository {
  constructor(private readonly db: Db) {}

  /** Both ends come from one statement: a second `now()` would leave a gap between
   *  what was looked at and what the watermark records as looked at. */
  async crossedSince(): Promise<BoundaryWindow> {
    const [bounds] = await this.db
      .select({
        since: reconcilerState.lastBoundarySweepAt,
        // `string`, not `Date`: a raw fragment has no column mapper, so it arrives
        // as the driver's text and an annotation of `Date` fails at the first use.
        windowEnd: sql<string>`now() - make_interval(secs => ${COMMIT_LAG_SECONDS})`,
      })
      .from(reconcilerState);

    if (bounds === undefined) {
      throw new Error('reconciler_state holds no row; the sweep has no watermark to start from');
    }
    const since = bounds.since;
    const windowEnd = new Date(bounds.windowEnd);

    // A window that ends before it starts means the clock moved backwards under a
    // mark written from a clock that was ahead. Sweeping nothing is right; moving
    // the mark back to `windowEnd` would drop the hour in between.
    if (windowEnd <= since) return { since, windowEnd: since, promotionIds: [] };

    const rows = await this.db
      .select({ id: promotions.id })
      .from(promotions)
      // Half-open at both ends: `since` was covered by the sweep that set it and
      // `windowEnd` is covered by this one, so no boundary is read twice or missed.
      // `created_at` is here because a promotion born already running has no
      // boundary ahead of it to cross — its announcement is the only one it gets.
      .where(
        and(
          ne(promotions.status, 'draft'),
          or(
            and(gt(promotions.startsAt, since), lte(promotions.startsAt, windowEnd)),
            and(gt(promotions.endsAt, since), lte(promotions.endsAt, windowEnd)),
            and(gt(promotions.cancelledAt, since), lte(promotions.cancelledAt, windowEnd)),
            and(gt(promotions.createdAt, since), lte(promotions.createdAt, windowEnd)),
          ),
        ),
      )
      .orderBy(asc(promotions.id));

    // A promotion whose window opened and closed inside one sweep matches twice and
    // is announced once; its handler would recompute the same prices either way.
    return { since, windowEnd, promotionIds: [...new Set(rows.map((row) => row.id))] };
  }

  /** Compare-and-set: two reconcilers on one window would otherwise let the slower
   *  write its earlier end over the faster one's, moving the watermark backwards. */
  async advance(from: Date, to: Date): Promise<boolean> {
    const rows = await this.db
      .update(reconcilerState)
      .set({ lastBoundarySweepAt: to })
      .where(eq(reconcilerState.lastBoundarySweepAt, from))
      .returning({ id: reconcilerState.id });

    return rows.length === 1;
  }
}
