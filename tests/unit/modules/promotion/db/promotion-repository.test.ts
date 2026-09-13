import { describe, expect, it } from 'vitest';
import { PromotionRepository } from '@src/modules/promotion/db/promotion-repository.js';
import type { Db } from '@src/shared/db/client.js';

const exclusionViolation = Object.assign(new Error('conflicting key value'), { code: '23P01' });

/** An update that trips the exclusion constraint. */
const conflicting = {
  update: () => ({
    set: () => ({ where: () => ({ returning: () => Promise.reject(exclusionViolation) }) }),
  }),
  select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
} as unknown as Db;

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
} as Parameters<PromotionRepository['insert']>[0];

describe('PromotionRepository.assign', () => {
  it('reports an overlap and reads nothing further about the row in the way', async () => {
    // The outcome carries no id: there is no `details` to put one in, and the
    // lookup that used to fill it was a query whose result the route discarded.
    const outcome = await new PromotionRepository(conflicting).assign(7, {
      category: 'Accessories',
    });

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

    await expect(
      new PromotionRepository(db).assign(7, { category: 'Accessories' }),
    ).rejects.toThrow('connection terminated');
  });
});

describe('PromotionRepository.insert', () => {
  it('rethrows an error that is neither an overlap nor a missing product', async () => {
    // 23514 is check_violation: a real failure the constraints catch, and
    // answering 409 to it would tell an admin their window overlaps when it does not.
    const other = Object.assign(new Error('violates check constraint'), { code: '23514' });

    await expect(new PromotionRepository(rejecting(other)).insert(input)).rejects.toBe(other);
  });

  it('reports a missing product rather than a server fault', async () => {
    const violation = Object.assign(new Error('violates foreign key constraint'), {
      code: '23503',
    });

    await expect(new PromotionRepository(rejecting(violation)).insert(input)).resolves.toEqual({
      ok: false,
      reason: 'no-such-product',
    });
  });

  it('reports an overlap', async () => {
    const violation = Object.assign(new Error('conflicting key value'), { code: '23P01' });

    await expect(new PromotionRepository(rejecting(violation)).insert(input)).resolves.toEqual({
      ok: false,
      reason: 'overlap',
    });
  });
});
