import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '@src/app.js';
import type { Db } from '@src/shared/db/client.js';
import type { Enqueue } from '@src/shared/enqueue.js';
import { captureLogger } from '../../../../capture-logger.js';

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

const enqueue: Enqueue = () => Promise.resolve();

const validBody = (sku: string) => ({
  sku,
  name: 'Wool scarf',
  category: 'Accessories',
  basePriceCents: 4999,
  stockQuantity: 12,
});

describe('POST /api/products when the write fails', () => {
  it('answers 500 INTERNAL and tells the client nothing about the failure', async () => {
    const { logger } = captureLogger();
    const failure = Object.assign(new Error('violates check constraint "products_sku_key"'), {
      code: '23514',
    });

    const res = await request(createApp({ logger, db: throwingDb(failure), enqueue }))
      .post('/api/products')
      .send({
        sku: 'MC-9001',
        name: 'Wool scarf',
        category: 'Accessories',
        basePriceCents: 4999,
        stockQuantity: 12,
      });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    // The constraint name is a detail of our schema, not the caller's business.
    expect(JSON.stringify(res.body)).not.toContain('products_sku_key');
  });

  it('answers 500 rather than a half-built product when the insert returns no row', async () => {
    const returningNothing = {
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    } as unknown as Db;

    const res = await request(
      createApp({ logger: captureLogger().logger, db: returningNothing, enqueue }),
    )
      .post('/api/products')
      .send(validBody('MC-9003'));

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });

  it('logs an enqueue failure that is not an Error at all', async () => {
    // A rejection with a string reaches the same handler, and the log line must
    // still be written rather than throwing inside the error path.
    const { logger, lines } = captureLogger();
    const rejectsWithString: Enqueue = () => Promise.reject('Redis is down');
    const db = {
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve([{ id: 7, ...validBody('MC-9004') }]),
        }),
      }),
    } as unknown as Db;

    const res = await request(createApp({ logger, db, enqueue: rejectsWithString }))
      .post('/api/products')
      .send(validBody('MC-9004'));

    expect(res.status).toBe(201);
    expect(lines.some((line) => String(line.msg).includes('could not be enqueued'))).toBe(true);
  });

  it('logs the enqueue failure without failing the request', async () => {
    const { logger, lines } = captureLogger();
    const failing: Enqueue = () => Promise.reject(new Error('Redis is down'));
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

    const res = await request(createApp({ logger, db, enqueue: failing }))
      .post('/api/products')
      .send({
        sku: 'MC-9002',
        name: 'Wool scarf',
        category: 'Accessories',
        basePriceCents: 4999,
        stockQuantity: 12,
      });

    expect(res.status).toBe(201);
    expect(lines.some((line) => String(line.msg).includes('could not be enqueued'))).toBe(true);
  });
});
