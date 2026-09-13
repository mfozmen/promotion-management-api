import { describe, expect, it } from 'vitest';
import { insertPromotion } from '@src/modules/promotion/db/insert-promotion.js';
import type { Db } from '@src/shared/db/client.js';

const rejecting = (error: unknown) =>
  ({
    insert: () => ({ values: () => ({ returning: () => Promise.reject(error) }) }),
  }) as unknown as Db;

const input = {
  name: 'Autumn sale',
  discountType: 'percentage',
  value: 1_000,
  startsAt: '2026-09-13T00:00:00.000Z',
  endsAt: '2026-09-14T00:00:00.000Z',
  category: 'Knitwear',
} as Parameters<typeof insertPromotion>[1];

describe('insertPromotion', () => {
  it('rethrows an error that is neither an overlap nor a missing product', async () => {
    // 23514 is check_violation: a real failure the constraints catch, and
    // answering 409 to it would tell an admin their window overlaps when it does not.
    const other = Object.assign(new Error('violates check constraint'), { code: '23514' });

    await expect(insertPromotion(rejecting(other), input)).rejects.toBe(other);
  });

  it('reports a missing product rather than a server fault', async () => {
    const violation = Object.assign(new Error('violates foreign key constraint'), {
      code: '23503',
    });

    await expect(insertPromotion(rejecting(violation), input)).resolves.toEqual({
      ok: false,
      reason: 'no-such-product',
    });
  });

  it('reports an overlap', async () => {
    const violation = Object.assign(new Error('conflicting key value'), { code: '23P01' });

    await expect(insertPromotion(rejecting(violation), input)).resolves.toEqual({
      ok: false,
      reason: 'overlap',
    });
  });
});
