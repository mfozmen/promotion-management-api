import { describe, expect, it } from 'vitest';
import { assignPromotion } from '@src/modules/promotion/db/assign-promotion.js';
import type { Db } from '@src/shared/db/client.js';

const exclusionViolation = Object.assign(new Error('conflicting key value'), { code: '23P01' });

/** An update that trips the exclusion constraint. */
const conflicting = {
  update: () => ({
    set: () => ({ where: () => ({ returning: () => Promise.reject(exclusionViolation) }) }),
  }),
  select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
} as unknown as Db;

describe('assignPromotion', () => {
  it('reports an overlap and reads nothing further about the row in the way', async () => {
    // The outcome carries no id: there is no `details` to put one in, and the
    // lookup that used to fill it was a query whose result the route discarded.
    const outcome = await assignPromotion(conflicting, 7, { category: 'Accessories' });

    expect(outcome).toEqual({ ok: false, reason: 'overlap' });
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
