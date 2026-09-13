import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '@src/app.js';
import type { Db } from '@src/shared/db/client.js';
import type { Enqueue } from '@src/shared/enqueue.js';
import type { PromotionBoundaries } from '@src/shared/promotion-boundaries.js';
import { captureLogger } from '../../../../capture-logger.js';

const hour = 3_600_000;
const body = {
  name: 'Autumn sale',
  discountType: 'percentage' as const,
  value: 1500,
  startsAt: new Date(Date.now() + hour).toISOString(),
  endsAt: new Date(Date.now() + 4 * hour).toISOString(),
  category: 'Accessories',
};

const stored = {
  id: 7,
  name: body.name,
  discountType: 'percentage' as const,
  value: 1500,
  startsAt: new Date(body.startsAt),
  endsAt: new Date(body.endsAt),
  productId: null,
  category: 'Accessories',
  status: 'active' as const,
  state: 'scheduled' as const,
  now: new Date(),
};

const insertReturning = (rows: unknown[]) =>
  ({
    insert: () => ({ values: () => ({ returning: () => Promise.resolve(rows) }) }),
  }) as unknown as Db;

const silentBoundaries: PromotionBoundaries = {
  schedule: () => Promise.resolve(),
  remove: () => Promise.resolve(),
};

const noopEnqueue: Enqueue = () => Promise.resolve();

describe('POST /api/promotions when the announcement fails', () => {
  it('still answers 201 and logs it for the reconciler', async () => {
    // The row is committed. Refusing the write because Redis is unreachable
    // would lose the admin's promotion to repair a cache that repairs itself.
    const { logger, lines } = captureLogger();
    const failing: Enqueue = () => Promise.reject(new Error('Redis is down'));

    const res = await request(
      createApp({
        logger,
        db: insertReturning([stored]),
        enqueue: failing,
        boundaries: silentBoundaries,
      }),
    )
      .post('/api/promotions')
      .send(body);

    expect(res.status).toBe(201);
    expect(lines.some((line) => String(line.msg).includes('could not be announced'))).toBe(true);
  });

  it('survives a boundary scheduler that throws a non-Error', async () => {
    const { logger, lines } = captureLogger();
    const throwingBoundaries: PromotionBoundaries = {
      schedule: () => Promise.reject('Redis is down'),
      remove: () => Promise.resolve(),
    };

    const res = await request(
      createApp({
        logger,
        db: insertReturning([stored]),
        enqueue: noopEnqueue,
        boundaries: throwingBoundaries,
      }),
    )
      .post('/api/promotions')
      .send(body);

    expect(res.status).toBe(201);
    expect(lines.some((line) => String(line.msg).includes('could not be announced'))).toBe(true);
  });

  it('answers 500 rather than a half-built promotion when the insert returns no row', async () => {
    const res = await request(
      createApp({
        logger: captureLogger().logger,
        db: insertReturning([]),
        enqueue: noopEnqueue,
        boundaries: silentBoundaries,
      }),
    )
      .post('/api/promotions')
      .send(body);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });
});

describe('POST /api/promotions/:id/cancel when the announcement fails', () => {
  it('still answers 200 and logs it', async () => {
    const { logger, lines } = captureLogger();
    const cancelled = { ...stored, status: 'cancelled' as const, state: 'cancelled' as const };
    const db = {
      update: () => ({
        set: () => ({ where: () => ({ returning: () => Promise.resolve([cancelled]) }) }),
      }),
    } as unknown as Db;

    const res = await request(
      createApp({
        logger,
        db,
        enqueue: () => Promise.reject(new Error('Redis is down')),
        boundaries: silentBoundaries,
      }),
    )
      .post('/api/promotions/7/cancel')
      .send();

    expect(res.status).toBe(200);
    expect(lines.some((line) => String(line.msg).includes('could not be announced'))).toBe(true);
  });
});

describe('the promotion routes are not mounted without their dependencies', () => {
  it('answers 404 when the app has a database but no boundary scheduler', async () => {
    const res = await request(
      createApp({ db: insertReturning([stored]), enqueue: noopEnqueue }),
    ).get('/api/promotions');

    expect(res.status).toBe(404);
  });
});

describe('POST /api/promotions/:id/cancel when the boundaries cannot be dropped', () => {
  it('still answers 200, because the row is already cancelled', async () => {
    // The failure that made this a test: an unguarded await here turned a
    // committed cancellation into a 500 and skipped promotion.changed, so the
    // storefront kept serving the sale price with nothing to repair it.
    const { logger, lines } = captureLogger();
    const cancelled = { ...stored, status: 'cancelled' as const, state: 'cancelled' as const };
    const db = {
      update: () => ({
        set: () => ({ where: () => ({ returning: () => Promise.resolve([cancelled]) }) }),
      }),
    } as unknown as Db;

    const res = await request(
      createApp({
        logger,
        db,
        enqueue: noopEnqueue,
        boundaries: {
          schedule: () => Promise.resolve(),
          remove: () => Promise.reject(new Error('Redis is down')),
        },
      }),
    )
      .post('/api/promotions/7/cancel')
      .send();

    expect(res.status).toBe(200);
    expect(lines.some((line) => String(line.msg).includes('could not be announced'))).toBe(true);
  });
});

describe('a rejection that is not an Error still reaches the log', () => {
  it('logs and answers 200 when the boundary removal rejects with a string', async () => {
    const { logger, lines } = captureLogger();
    const cancelled = { ...stored, status: 'cancelled' as const, state: 'cancelled' as const };
    const db = {
      update: () => ({
        set: () => ({ where: () => ({ returning: () => Promise.resolve([cancelled]) }) }),
      }),
    } as unknown as Db;

    const res = await request(
      createApp({
        logger,
        db,
        enqueue: noopEnqueue,
        boundaries: { schedule: () => Promise.resolve(), remove: () => Promise.reject('gone') },
      }),
    )
      .post('/api/promotions/7/cancel')
      .send();

    expect(res.status).toBe(200);
    expect(lines.some((line) => String(line.msg).includes('could not be announced'))).toBe(true);
  });
});

describe('a failing boundary call never costs the event', () => {
  const cancelled = { ...stored, status: 'cancelled' as const, state: 'cancelled' as const };
  const cancellingDb = {
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([cancelled]) }) }),
    }),
  } as unknown as Db;

  it('still emits promotion.changed when the boundary removal rejects', async () => {
    // The regression this exists for: with `remove` awaited before `enqueue` in
    // one try, a Redis timeout swallowed the invalidation and left a cancelled
    // sale priced on the storefront. Asserting the 200 alone did not see it.
    const emitted: { name: string; payload: unknown }[] = [];
    const recording: Enqueue = (name, payload) => {
      emitted.push({ name, payload });
      return Promise.resolve();
    };

    const res = await request(
      createApp({
        logger: captureLogger().logger,
        db: cancellingDb,
        enqueue: recording,
        boundaries: {
          schedule: () => Promise.resolve(),
          remove: () => Promise.reject(new Error('Redis is down')),
        },
      }),
    )
      .post('/api/promotions/7/cancel')
      .send();

    expect(res.status).toBe(200);
    expect(emitted).toEqual([{ name: 'promotion.changed', payload: { promotionId: 7 } }]);
  });

  it('schedules the expiry even when the activation fails to schedule', async () => {
    // Losing `expire` gives a discount away past its window; losing `activate`
    // only delays one. Sequential awaits meant one failure took the other.
    const scheduled: string[] = [];
    const res = await request(
      createApp({
        logger: captureLogger().logger,
        db: insertReturning([stored]),
        enqueue: noopEnqueue,
        boundaries: {
          schedule: (_id, boundary) => {
            if (boundary === 'activate') return Promise.reject(new Error('Redis is down'));
            scheduled.push(boundary);
            return Promise.resolve();
          },
          remove: () => Promise.resolve(),
        },
      }),
    )
      .post('/api/promotions')
      .send(body);

    expect(res.status).toBe(201);
    expect(scheduled).toEqual(['expire']);
  });
});
