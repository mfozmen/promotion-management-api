import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { appDeps } from '@tests/app-deps.js';
import { createApp } from '@src/app.js';
import type { Db } from '@src/shared/db/client.js';
import type { Publish } from '@src/events/publish.js';
import { captureLogger } from '../../../capture-logger.js';

/**
 * What the endpoint does when the write itself fails for a reason that is not a
 * duplicate SKU. A real database cannot be made to fail on demand without
 * breaking every other test in the file, so the failure is injected here and the
 * happy paths stay on the real one (`product-create.test.ts`).
 */
const throwingDb = (error: unknown) =>
  ({
    insert: () => ({
      values: () => ({
        returning: () => Promise.reject(error),
      }),
    }),
  }) as unknown as Db;

const publish: Publish = () => Promise.resolve();

const validBody = (sku: string) => ({
  sku,
  name: 'Wool scarf',
  category: 'Accessories',
  basePriceCents: 4999,
  stockQuantity: 12,
});

describe('POST /api/products when the write fails', () => {
  it('answers 500 and tells the client nothing about the failure', async () => {
    const { logger } = captureLogger();
    const failure = Object.assign(new Error('violates check constraint "products_sku_key"'), {
      code: '23514',
    });

    const res = await request(createApp(appDeps({ logger, db: throwingDb(failure), publish })))
      .post('/api/products')
      .send({
        sku: 'MC-9001',
        name: 'Wool scarf',
        category: 'Accessories',
        basePriceCents: 4999,
        stockQuantity: 12,
      });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { message: 'Internal server error' } });
    // The constraint name is a detail of our schema, not the caller's business.
    expect(JSON.stringify(res.body)).not.toContain('products_sku_key');
  });

  it('answers 500 rather than a half-built product when the insert returns no row', async () => {
    const returningNothing = {
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    } as unknown as Db;

    const res = await request(
      createApp(appDeps({ logger: captureLogger().logger, db: returningNothing, publish })),
    )
      .post('/api/products')
      .send(validBody('MC-9003'));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { message: 'Internal server error' } });
  });

  it('logs an enqueue failure that is not an Error at all', async () => {
    // A rejection with a string reaches the same handler, and the log line must
    // still be written rather than throwing inside the error path.
    const { logger, lines } = captureLogger();
    const rejectsWithString: Publish = () => Promise.reject('Redis is down');
    const db = {
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve([{ id: 7, ...validBody('MC-9004') }]),
        }),
      }),
    } as unknown as Db;

    const res = await request(createApp(appDeps({ logger, db, publish: rejectsWithString })))
      .post('/api/products')
      .send(validBody('MC-9004'));

    expect(res.status).toBe(201);
    expect(
      lines.some((line: Record<string, unknown>) =>
        String(line.msg).includes('could not be enqueued'),
      ),
    ).toBe(true);
  });

  it('logs the enqueue failure without failing the request', async () => {
    const { logger, lines } = captureLogger();
    const failing: Publish = () => Promise.reject(new Error('Redis is down'));
    const db = {
      insert: () => ({
        values: () => ({
          returning: () =>
            Promise.resolve([
              {
                id: 1,
                sku: 'MC-9002',
                name: 'Wool scarf',
                category: 'Accessories',
                basePriceCents: 4999,
                stockQuantity: 12,
              },
            ]),
        }),
      }),
    } as unknown as Db;

    const res = await request(createApp(appDeps({ logger, db, publish: failing })))
      .post('/api/products')
      .send({
        sku: 'MC-9002',
        name: 'Wool scarf',
        category: 'Accessories',
        basePriceCents: 4999,
        stockQuantity: 12,
      });

    expect(res.status).toBe(201);
    expect(
      lines.some((line: Record<string, unknown>) =>
        String(line.msg).includes('could not be enqueued'),
      ),
    ).toBe(true);
  });
});
