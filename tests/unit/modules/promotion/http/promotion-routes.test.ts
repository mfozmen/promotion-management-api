import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { appDeps } from '@tests/app-deps.js';
import { createApp } from '@src/app.js';
import type { Db } from '@src/shared/db/client.js';
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

const noopPublish = { publish: () => Promise.resolve() };

describe('POST /api/promotions when the announcement fails', () => {
  it('still answers 201 and logs it for the reconciler', async () => {
    const { logger, lines } = captureLogger();
    const failing = { publish: () => Promise.reject(new Error('Redis is down')) };

    const res = await request(
      createApp(
        appDeps({
          logger,
          db: insertReturning([stored]),
          queue: failing,
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
          queue: noopPublish,
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
          queue: { publish: () => Promise.reject(new Error('Redis is down')) },
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
          queue: noopPublish,
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
          queue: noopPublish,
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
    // The 200 alone does not see this: the order is what matters.
    const emitted: { name: string; payload: unknown }[] = [];
    const recording = {
      publish: (name: string, payload: unknown) => {
        emitted.push({ name, payload });

        return Promise.resolve();
      },
    };

    const res = await request(
      createApp(
        appDeps({
          logger: captureLogger().logger,
          db: cancellingDb,
          queue: recording,
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
    // only delays one, so one failure must not take the other.
    const scheduled: string[] = [];
    const res = await request(
      createApp(
        appDeps({
          logger: captureLogger().logger,
          db: insertReturning([stored]),
          queue: noopPublish,
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
