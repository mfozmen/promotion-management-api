import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { appDeps } from '@tests/app-deps.js';
import { createApp } from '@src/app.js';
import type { Db } from '@src/shared/db/client.js';
import type { Publish } from '@src/events/publish.js';
import { PromotionScheduler } from '@src/modules/promotion/domain/promotion-scheduler.js';
import { captureLogger } from '../../../capture-logger.js';

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

const silentScheduler = new PromotionScheduler({
  publish: () => Promise.resolve({} as never),
  remove: () => Promise.resolve(1),
});

/** A scheduler whose queue refuses, for the paths that must survive one. */
const failingScheduler = (error: unknown) =>
  new PromotionScheduler({
    publish: () => Promise.reject(error),
    remove: () => Promise.reject(error),
  });

const noopPublish: Publish = () => Promise.resolve();

describe('POST /api/promotions when the announcement fails', () => {
  it('still answers 201 and logs it for the reconciler', async () => {
    // The row is committed. Refusing the write because Redis is unreachable
    // would lose the admin's promotion to repair a cache that repairs itself.
    const { logger, lines } = captureLogger();
    const failing: Publish = () => Promise.reject(new Error('Redis is down'));

    const res = await request(
      createApp(
        appDeps({
          logger,
          db: insertReturning([stored]),
          publish: failing,
          scheduler: silentScheduler,
        }),
      ),
    )
      .post('/api/promotions')
      .send(body);

    expect(res.status).toBe(201);
    expect(
      lines.some((line: Record<string, unknown>) =>
        String(line.msg).includes('could not be announced'),
      ),
    ).toBe(true);
  });

  it('survives a boundary scheduler that throws a non-Error', async () => {
    const { logger, lines } = captureLogger();

    const res = await request(
      createApp(
        appDeps({
          logger,
          db: insertReturning([stored]),
          publish: noopPublish,
          scheduler: failingScheduler('Redis is down'),
        }),
      ),
    )
      .post('/api/promotions')
      .send(body);

    expect(res.status).toBe(201);
    expect(
      lines.some((line: Record<string, unknown>) =>
        String(line.msg).includes('could not be announced'),
      ),
    ).toBe(true);
  });

  it('answers 500 rather than a half-built promotion when the insert returns no row', async () => {
    const res = await request(
      createApp(
        appDeps({
          logger: captureLogger().logger,
          db: insertReturning([]),
          publish: noopPublish,
          scheduler: silentScheduler,
        }),
      ),
    )
      .post('/api/promotions')
      .send(body);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { message: 'Internal server error' } });
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
      createApp(
        appDeps({
          logger,
          db,
          publish: () => Promise.reject(new Error('Redis is down')),
          scheduler: silentScheduler,
        }),
      ),
    )
      .post('/api/promotions/7/cancel')
      .send();

    expect(res.status).toBe(200);
    expect(
      lines.some((line: Record<string, unknown>) =>
        String(line.msg).includes('could not be announced'),
      ),
    ).toBe(true);
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
      createApp(
        appDeps({
          logger,
          db,
          publish: noopPublish,
          scheduler: new PromotionScheduler({
            publish: () => Promise.resolve({} as never),
            remove: () => Promise.reject(new Error('Redis is down')),
          }),
        }),
      ),
    )
      .post('/api/promotions/7/cancel')
      .send();

    expect(res.status).toBe(200);
    expect(
      lines.some((line: Record<string, unknown>) =>
        String(line.msg).includes('could not be announced'),
      ),
    ).toBe(true);
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
      createApp(
        appDeps({
          logger,
          db,
          publish: noopPublish,
          scheduler: failingScheduler('gone'),
        }),
      ),
    )
      .post('/api/promotions/7/cancel')
      .send();

    expect(res.status).toBe(200);
    expect(
      lines.some((line: Record<string, unknown>) =>
        String(line.msg).includes('could not be announced'),
      ),
    ).toBe(true);
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
    const recording: Publish = (name, payload) => {
      emitted.push({ name, payload });
      return Promise.resolve();
    };

    const res = await request(
      createApp(
        appDeps({
          logger: captureLogger().logger,
          db: cancellingDb,
          publish: recording,
          scheduler: new PromotionScheduler({
            publish: () => Promise.resolve({} as never),
            remove: () => Promise.reject(new Error('Redis is down')),
          }),
        }),
      ),
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
      createApp(
        appDeps({
          logger: captureLogger().logger,
          db: insertReturning([stored]),
          publish: noopPublish,
          scheduler: new PromotionScheduler({
            publish: (_name, _payload, options) => {
              const boundary = String(options?.jobId ?? '').endsWith(':activate')
                ? 'activate'
                : 'expire';
              if (boundary === 'activate') return Promise.reject(new Error('Redis is down'));
              scheduled.push(boundary);
              return Promise.resolve({} as never);
            },
            remove: () => Promise.resolve(1),
          }),
        }),
      ),
    )
      .post('/api/promotions')
      .send(body);

    expect(res.status).toBe(201);
    expect(scheduled).toEqual(['expire']);
  });
});
