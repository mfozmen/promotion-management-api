import { eq } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { appDeps } from '@tests/app-deps.js';
import { createApp } from '@src/app.js';
import { products } from '@src/modules/product/db/schema/products.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

/**
 * A queue stand-in that records what was enqueued. The queue contract itself is
 * tested against a real Redis in `queue.test.ts`; what these tests assert is that
 * the endpoint enqueues the right event after the commit, and that it survives the
 * enqueue failing — neither of which needs a broker to be true.
 */
function recordingQueue() {
  const enqueued: { name: string; payload: unknown }[] = [];

  return {
    enqueued,
    queue: {
      publish: (name: string, payload: unknown) => {
        enqueued.push({ name, payload });

        return Promise.resolve();
      },
    },
  };
}

const failingQueue = { publish: () => Promise.reject(new Error('Redis is down')) };

// One database per test file, so a fixed SKU would make every test after the
// first collide with the unique index rather than with what it means to assert.
let sequence = 0;
const newBody = () => ({
  sku: `MC-${(sequence += 1).toString().padStart(4, '0')}`,
  name: 'Wool scarf',
  category: 'Accessories',
  basePriceCents: 4999,
  stockQuantity: 12,
});

describe('POST /api/products', () => {
  it('stores the product and answers 201 with it', async () => {
    const body = newBody();
    const recorded = recordingQueue();
    const res = await request(createApp(appDeps({ db: db(), queue: recorded.queue })))
      .post('/api/products')
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      sku: body.sku,
      name: 'Wool scarf',
      category: 'Accessories',
      basePriceCents: 4999,
      stockQuantity: 12,
    });
    expect(res.body.id).toBeTypeOf('number');

    const stored = await db().select().from(products).where(eq(products.sku, body.sku));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.basePriceCents).toBe(4999);
  });

  it('returns only the fields the API owns, never the ingestion columns', async () => {
    const recorded = recordingQueue();
    const res = await request(createApp(appDeps({ db: db(), queue: recorded.queue })))
      .post('/api/products')
      .send(newBody());

    expect(Object.keys(res.body).sort()).toEqual([
      'basePriceCents',
      'category',
      'id',
      'name',
      'sku',
      'stockQuantity',
    ]);
  });

  it('enqueues product.upserted with the new id', async () => {
    const recorded = recordingQueue();
    const res = await request(createApp(appDeps({ db: db(), queue: recorded.queue })))
      .post('/api/products')
      .send(newBody());

    expect(recorded.enqueued).toEqual([
      { name: 'product.upserted', payload: { productIds: [res.body.id] } },
    ]);
  });

  it('enqueues only after the row is committed', async () => {
    // The ordering this pins: an enqueue before the commit publishes an id a
    // rollback would take away, and the worker then recomputes a product that
    // does not exist. Reading the row from the pool at the moment the event is
    // enqueued is how that ordering is visible from outside .
    let visibleWhenEnqueued: number | undefined;
    const queue = {
      publish: async (_name: string, payload: unknown) => {
        const { productIds } = payload as { productIds: number[] };
        const rows = await db()
          .select()
          .from(products)
          .where(eq(products.id, productIds[0] as number));
        visibleWhenEnqueued = rows.length;
      },
    };

    await request(createApp(appDeps({ db: db(), queue })))
      .post('/api/products')
      .send(newBody());

    expect(visibleWhenEnqueued).toBe(1);
  });

  it('answers 409 SKU_EXISTS for a duplicate sku, and enqueues nothing', async () => {
    const body = newBody();
    const recorded = recordingQueue();
    const app = createApp(appDeps({ db: db(), queue: recorded.queue }));
    await request(app).post('/api/products').send(body);
    recorded.enqueued.length = 0;

    const res = await request(app)
      .post('/api/products')
      .send({ ...body, name: 'A different name' });

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ message: 'A product with this SKU already exists' });
    expect(recorded.enqueued).toEqual([]);
  });

  it('still answers 201 when the event cannot be enqueued', async () => {
    // The row is committed; losing the event costs read-model freshness until
    // the reconciler sweeps, which is a smaller failure than losing the write.
    const body = newBody();
    const res = await request(createApp(appDeps({ db: db(), queue: failingQueue })))
      .post('/api/products')
      .send(body);

    expect(res.status).toBe(201);
    const stored = await db().select().from(products).where(eq(products.sku, body.sku));
    expect(stored).toHaveLength(1);
  });

  it.each([
    ['a negative price', { basePriceCents: -1 }],
    ['a fractional price', { basePriceCents: 49.99 }],
    ['a negative stock quantity', { stockQuantity: -1 }],
    ['a fractional stock quantity', { stockQuantity: 1.5 }],
    ['a blank sku', { sku: '   ' }],
    ['a blank category', { category: '' }],
    ['a missing name', { name: undefined }],
    ['an unknown field', { colour: 'red' }],
  ])('answers 400 VALIDATION_ERROR for %s', async (_case, patch) => {
    const recorded = recordingQueue();
    const res = await request(createApp(appDeps({ db: db(), queue: recorded.queue })))
      .post('/api/products')
      .send({ ...newBody(), ...patch });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/^Invalid request /);
    expect(recorded.enqueued).toEqual([]);
  });

  it('does not echo the rejected value back to the caller', async () => {
    // REVIEW.md 8.4: the response names the field, never what the client sent.
    const res = await request(createApp(appDeps({ db: db(), queue: recordingQueue().queue })))
      .post('/api/products')
      .send({ ...newBody(), sku: 'secret-looking-value'.repeat(20) });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('secret-looking-value');
  });
});
