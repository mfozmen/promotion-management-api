import { describe, expect, it } from 'vitest';
import { assignPromotion } from '@src/modules/promotion/db/assign-promotion.js';
import type { Db } from '@src/shared/db/client.js';

const exclusionViolation = Object.assign(new Error('conflicting key value'), { code: '23P01' });

/** An update that trips the exclusion constraint, over a table that then reads empty. */
const conflictingThenVanished = {
  update: () => ({
    set: () => ({ where: () => ({ returning: () => Promise.reject(exclusionViolation) }) }),
  }),
  select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
} as unknown as Db;

describe('assignPromotion', () => {
  it('reports an overlap with no id when the promotion itself has vanished', async () => {
    // Its window is what the conflict lookup needs, so a promotion deleted
    // between the failed update and the lookup leaves nothing to search with.
    const outcome = await assignPromotion(conflictingThenVanished, 7, { category: 'Accessories' });

    expect(outcome).toEqual({ ok: false, reason: 'overlap', conflictingPromotionId: null });
  });

  it('rethrows an error that is not an exclusion violation', async () => {
    const db = {
      update: () => ({
        set: () => ({
          where: () => ({ returning: () => Promise.reject(new Error('connection terminated')) }),
        }),
      }),
    } as unknown as Db;

    await expect(assignPromotion(db, 7, { category: 'Accessories' })).rejects.toThrow(
      'connection terminated',
    );
  });
});
