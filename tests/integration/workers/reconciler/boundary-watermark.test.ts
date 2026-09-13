import { describe, expect, it } from 'vitest';
import { promotions } from '@src/modules/promotion/db/schema/promotions.js';
import { reconcilerState } from '@src/workers/reconciler/db/schema/reconciler-state.js';
import { BoundaryWatermark } from '@src/workers/reconciler/db/boundary-watermark.js';
import { useTestDatabase } from '../../db.js';

const db = useTestDatabase();

// Fixtures are positioned from the process clock and the window from the database's.
// Minutes of margin, so a second of skew between the two decides nothing.
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
      ...columns,
    })
    .returning({ id: promotions.id });

  return Number((row as { id: number }).id);
}

/** The watermark is written by the migration's default, so a test moves it back. */
async function watermarkAt(minutes: number): Promise<void> {
  await db()
    .update(reconcilerState)
    .set({ lastBoundarySweepAt: minutesAgo(minutes) });
}

describe('BoundaryWatermark', () => {
  it('finds a promotion whose start crossed inside the window', async () => {
    await watermarkAt(10);
    const id = await promotionWith({ startsAt: minutesAgo(5) });

    const { promotionIds } = await new BoundaryWatermark(db()).crossedSince();

    expect(promotionIds).toContain(id);
  });

  it('finds one whose end crossed, and one that was cancelled', async () => {
    await watermarkAt(10);
    const ended = await promotionWith({
      startsAt: minutesAgo(60),
      endsAt: minutesAgo(3),
    });
    const cancelled = await promotionWith({
      status: 'cancelled',
      cancelledAt: minutesAgo(2),
    });

    const { promotionIds } = await new BoundaryWatermark(db()).crossedSince();

    expect(promotionIds).toEqual(expect.arrayContaining([ended, cancelled]));
  });

  it('leaves out a boundary older than the watermark and one still ahead', async () => {
    // The two halves of the window, each of which a wrong comparison would include:
    // the sweep that set the watermark already announced the first, and the second
    // has not happened yet.
    await watermarkAt(10);
    const before = await promotionWith({ startsAt: minutesAgo(30) });
    const ahead = await promotionWith({
      startsAt: minutesAhead(30),
      endsAt: minutesAhead(2_880),
    });

    const { promotionIds } = await new BoundaryWatermark(db()).crossedSince();

    expect(promotionIds).not.toContain(before);
    expect(promotionIds).not.toContain(ahead);
  });

  it('names a promotion once when both its boundaries fall in the window', async () => {
    await watermarkAt(10);
    const id = await promotionWith({ startsAt: minutesAgo(6), endsAt: minutesAgo(2) });

    const { promotionIds } = await new BoundaryWatermark(db()).crossedSince();

    expect(promotionIds.filter((each) => each === id)).toEqual([id]);
  });

  it('reads the window end from the database clock and advances the watermark to it', async () => {
    await watermarkAt(10);

    const { windowEnd } = await new BoundaryWatermark(db()).crossedSince();
    await new BoundaryWatermark(db()).advanceWatermark(windowEnd);

    const [state] = await db().select().from(reconcilerState);
    expect(state?.lastBoundarySweepAt).toEqual(windowEnd);
    // The next window opens where this one closed, so nothing between them is lost.
    const { promotionIds } = await new BoundaryWatermark(db()).crossedSince();
    expect(promotionIds).toEqual([]);
  });
});
