import { describe, expect, it, vi } from 'vitest';
import { RepairDriftCommand } from '@src/modules/reconciler/commands/repair-drift-command.js';
import { captureLogger } from '../../../capture-logger.js';

const catalogue = (counts: [string, number][]) => ({
  categoryCounts: () => Promise.resolve(new Map(counts)),
});

const readModel = (counts: Record<string, number>) => ({
  count: (category?: string) => Promise.resolve(counts[category ?? ''] ?? 0),
});

describe('RepairDriftCommand', () => {
  it('repairs only the category whose counts disagree', async () => {
    // A category that lost a key should not cost the catalogue a full rebuild,
    // and the flash-sale path is the one this runs beside.
    const rebuild = {
      rebuildCategory: vi.fn<(c: string) => Promise<number>>().mockResolvedValue(3),
    };

    const repaired = await new RepairDriftCommand(
      catalogue([
        ['Accessories', 3],
        ['Shoes', 5],
      ]),
      readModel({ Accessories: 2, Shoes: 5 }),
      rebuild,
      captureLogger().logger,
    ).execute();

    expect(repaired).toBe(1);
    expect(rebuild.rebuildCategory.mock.calls).toEqual([['Accessories']]);
  });

  it('rebuilds nothing when every category agrees', async () => {
    const rebuild = { rebuildCategory: vi.fn<(c: string) => Promise<number>>() };

    const repaired = await new RepairDriftCommand(
      catalogue([['Shoes', 5]]),
      readModel({ Shoes: 5 }),
      rebuild,
      captureLogger().logger,
    ).execute();

    expect(repaired).toBe(0);
    expect(rebuild.rebuildCategory).not.toHaveBeenCalled();
  });

  it('names both counts in the line, because a repair with no numbers cannot be judged', async () => {
    const { logger, lines } = captureLogger();

    await new RepairDriftCommand(
      catalogue([['Shoes', 5]]),
      readModel({ Shoes: 1 }),
      { rebuildCategory: () => Promise.resolve(5) },
      logger,
    ).execute();

    expect(lines[0]).toMatchObject({ category: 'Shoes', products: 5, listed: 1, recomputed: 5 });
  });

  it('repairs a category the read model has lost entirely', async () => {
    // The failure this exists for: a key evicted or a partial restore, where no
    // event was missed so the boundary sweep has nothing to re-announce.
    const rebuild = {
      rebuildCategory: vi.fn<(c: string) => Promise<number>>().mockResolvedValue(9),
    };

    const repaired = await new RepairDriftCommand(
      catalogue([['Knitwear', 9]]),
      readModel({}),
      rebuild,
      captureLogger().logger,
    ).execute();

    expect(repaired).toBe(1);
  });
});
