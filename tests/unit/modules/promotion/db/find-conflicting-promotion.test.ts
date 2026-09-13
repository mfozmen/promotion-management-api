import { describe, expect, it } from 'vitest';
import { findConflictingPromotion } from '@src/modules/promotion/db/find-conflicting-promotion.js';
import type { Db } from '@src/shared/db/client.js';

const selecting = (rows: unknown[]) =>
  ({
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }),
      }),
    }),
  }) as unknown as Db;

const window = { startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000) };

describe('findConflictingPromotion', () => {
  it('reports no id when the conflicting row is gone by the time it looks', async () => {
    // The constraint fired, so a row did overlap; another request can cancel it
    // before this lookup runs. Reporting null beats inventing an id.
    const id = await findConflictingPromotion(selecting([]), { category: 'Accessories' }, window);

    expect(id).toBeNull();
  });

  it('reports the id when the row is still there', async () => {
    const id = await findConflictingPromotion(selecting([{ id: 42 }]), { productId: 1 }, window);

    expect(id).toBe(42);
  });
});
