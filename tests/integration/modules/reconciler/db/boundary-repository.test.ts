import { describe, expect, it } from 'vitest';
import { promotions } from '@src/modules/promotion/db/schema/promotions.js';
import { reconcilerState } from '@src/modules/reconciler/db/schema/reconciler-state.js';
import { BoundaryRepository } from '@src/modules/reconciler/db/boundary-repository.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

// Fixtures are positioned from the process clock and the window from the database's.
// Minutes of margin, so a second of skew between the two decides nothing — and every
// fixture sits well behind the sweep's 30-second commit lag.
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
const minutesAhead = (n: number) => new Date(Date.now() + n * 60_000);

let counter = 0;

async function promotionWith(columns: Record<string, unknown>): Promise<number> {
  counter += 1;
  const [row] = await db()
    .insert(promotions)
    .values({
      name: `Sweep ${String(counter)}`,
      discountType: 'percentage',
      value: 1_000,
      category: `sweep-${String(counter)}`,
      status: 'active',
      startsAt: minutesAgo(1_440),
      endsAt: minutesAhead(1_440),
      createdAt: minutesAgo(1_440),
      ...columns,
    })
    .returning({ id: promotions.id });

  return (row as { id: number }).id;
}

async function watermarkAt(minutes: number): Promise<void> {
  await db()
    .update(reconcilerState)
    .set({ lastBoundarySweepAt: minutesAgo(minutes) });
}

describe('BoundaryRepository', () => {
  it('finds a start, an end and a cancellation that crossed inside the window', async () => {
    await watermarkAt(10);
    const started = await promotionWith({ startsAt: minutesAgo(5) });
    const ended = await promotionWith({ startsAt: minutesAgo(60), endsAt: minutesAgo(3) });
    const cancelled = await promotionWith({ status: 'cancelled', cancelledAt: minutesAgo(2) });

    const { promotionIds } = await new BoundaryRepository(db()).crossedSince();

    expect(promotionIds).toEqual(expect.arrayContaining([started, ended, cancelled]));
  });

  it('finds one born already running, whose only announcement was its creation', async () => {
    // Create-with-target is active immediately: its start is in the past and its end
    // is a day out, so neither boundary ever falls in a window. Without `created_at`
    // a lost announcement here is repaired by nothing.
    await watermarkAt(10);
    const born = await promotionWith({
      startsAt: minutesAgo(90),
      endsAt: minutesAhead(1_440),
      createdAt: minutesAgo(4),
    });

    const { promotionIds } = await new BoundaryRepository(db()).crossedSince();

    expect(promotionIds).toContain(born);
  });

  it('leaves out a boundary older than the watermark and one still ahead', async () => {
    await watermarkAt(10);
    const before = await promotionWith({ startsAt: minutesAgo(30) });
    const ahead = await promotionWith({ startsAt: minutesAhead(30), endsAt: minutesAhead(2_880) });

    const { promotionIds } = await new BoundaryRepository(db()).crossedSince();

    expect(promotionIds).not.toContain(before);
    expect(promotionIds).not.toContain(ahead);
  });

  it('leaves out a boundary inside the commit lag, where a writer may still be uncommitted', async () => {
    // A writer takes its timestamps at the start of its transaction and commits
    // later. A window closing at `now()` would step over one still in flight, and
    // that boundary is then older than every future window's start.
    await watermarkAt(10);
    const justNow = await promotionWith({ startsAt: new Date(Date.now() - 2_000) });

    const { promotionIds } = await new BoundaryRepository(db()).crossedSince();

    expect(promotionIds).not.toContain(justNow);
  });

  it('leaves out a draft, which has no target to recompute', async () => {
    await watermarkAt(10);
    const draft = await promotionWith({
      status: 'draft',
      category: null,
      startsAt: minutesAgo(5),
    });

    const { promotionIds } = await new BoundaryRepository(db()).crossedSince();

    expect(promotionIds).not.toContain(draft);
  });

  it('names a promotion once when both its boundaries fall in the window', async () => {
    await watermarkAt(10);
    const id = await promotionWith({ startsAt: minutesAgo(6), endsAt: minutesAgo(2) });

    const { promotionIds } = await new BoundaryRepository(db()).crossedSince();

    expect(promotionIds.filter((each) => each === id)).toEqual([id]);
  });

  it('advances only for the sweep that still holds the mark it started from', async () => {
    await watermarkAt(10);
    const repository = new BoundaryRepository(db());
    const { since, windowEnd } = await repository.crossedSince();

    expect(await repository.advance(since, windowEnd)).toBe(true);
    // The second call is the slower of two reconcilers writing an earlier end over
    // a later one: it must lose rather than move the watermark backwards.
    expect(await repository.advance(since, windowEnd)).toBe(false);
  });

  it('opens the next window where this one closed', async () => {
    await watermarkAt(10);
    await promotionWith({ startsAt: minutesAgo(5) });
    const repository = new BoundaryRepository(db());

    const first = await repository.crossedSince();
    await repository.advance(first.since, first.windowEnd);
    const second = await repository.crossedSince();

    expect(second.since).toEqual(first.windowEnd);
    expect(second.promotionIds).toEqual([]);
  });

  it('reaches back an hour at a time after an outage, and takes the rest on the next run', async () => {
    // A day of downtime otherwise reads every boundary since in one statement and
    // publishes them in one loop; a run killed at its timeout advances nothing and
    // the next one repeats it. Time-boxing loses none of them: the mark moves.
    await watermarkAt(120);
    const inFirstHour = await promotionWith({ startsAt: minutesAgo(90) });
    const inSecondHour = await promotionWith({ startsAt: minutesAgo(30) });
    const repository = new BoundaryRepository(db());

    const first = await repository.crossedSince();

    expect(first.promotionIds).toContain(inFirstHour);
    expect(first.promotionIds).not.toContain(inSecondHour);
    expect(first.windowEnd.getTime() - first.since.getTime()).toBe(3_600_000);

    await repository.advance(first.since, first.windowEnd);
    const second = await repository.crossedSince();

    expect(second.promotionIds).toContain(inSecondHour);
  });

  it('refuses to sweep rather than crash when the watermark row is gone', async () => {
    // A truncate, an operator, or a dump restored without the seed. The cast that
    // reads the row would otherwise destructure `undefined`, and the sweep would
    // fail on a `TypeError` naming nothing an operator can act on.
    await db().delete(reconcilerState);
    try {
      await expect(new BoundaryRepository(db()).crossedSince()).rejects.toThrow(/no row/);
    } finally {
      // Restored here rather than relying on order: these cases share one clone.
      await db().insert(reconcilerState).values({});
    }
  });

  it('sweeps nothing and moves nothing when the watermark is ahead of the clock', async () => {
    // A mark written from a clock that had stepped forward. Advancing to `windowEnd`
    // would drop every boundary in between.
    await db()
      .update(reconcilerState)
      .set({ lastBoundarySweepAt: minutesAhead(60) });

    const { since, windowEnd, promotionIds } = await new BoundaryRepository(db()).crossedSince();

    expect(promotionIds).toEqual([]);
    expect(windowEnd).toEqual(since);
  });
});
