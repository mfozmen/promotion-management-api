import { Redis } from 'ioredis';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '@src/app.js';
import { seedProducts, useTestRedis, type SeedProduct } from '../../../redis.js';

const redis = useTestRedis();
const app = () => createApp({ redis: redis() });

const product = (over: Partial<SeedProduct> & Pick<SeedProduct, 'id'>): SeedProduct => ({
  sku: `SKU-${over.id}`,
  name: `Product ${over.id}`,
  category: 'Accessories',
  basePriceCents: 10_000,
  effectivePriceCents: 10_000,
  stockQuantity: 5,
  ...over,
});

describe('GET /api/products', () => {
  it('lists a category ordered by effective price, cheapest first', async () => {
    await seedProducts(redis(), [
      product({ id: 1, effectivePriceCents: 3_000 }),
      product({ id: 2, effectivePriceCents: 1_000 }),
      product({ id: 3, effectivePriceCents: 2_000 }),
      product({ id: 4, category: 'Shoes', effectivePriceCents: 500 }),
    ]);

    const res = await request(app()).get('/api/products?category=Accessories');

    expect(res.status).toBe(200);
    expect(res.body.items.map((item: { id: number }) => item.id)).toEqual([2, 3, 1]);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 3 });
  });

  it('orders most expensive first when asked', async () => {
    await seedProducts(redis(), [
      product({ id: 1, effectivePriceCents: 3_000 }),
      product({ id: 2, effectivePriceCents: 1_000 }),
    ]);

    const res = await request(app()).get('/api/products?category=Accessories&order=desc');

    expect(res.body.items.map((item: { id: number }) => item.id)).toEqual([1, 2]);
  });

  it('lists every category when none is given', async () => {
    await seedProducts(redis(), [
      product({ id: 1, effectivePriceCents: 3_000 }),
      product({ id: 4, category: 'Shoes', effectivePriceCents: 500 }),
    ]);

    const res = await request(app()).get('/api/products');

    expect(res.body.items.map((item: { id: number }) => item.id)).toEqual([4, 1]);
    expect(res.body.total).toBe(2);
  });

  it('pages without repeating or skipping a product', async () => {
    await seedProducts(
      redis(),
      Array.from({ length: 5 }, (_, index) =>
        product({ id: index + 1, effectivePriceCents: (index + 1) * 1_000 }),
      ),
    );

    const first = await request(app()).get('/api/products?pageSize=2&page=1');
    const second = await request(app()).get('/api/products?pageSize=2&page=2');
    const third = await request(app()).get('/api/products?pageSize=2&page=3');

    expect(first.body.items.map((i: { id: number }) => i.id)).toEqual([1, 2]);
    expect(second.body.items.map((i: { id: number }) => i.id)).toEqual([3, 4]);
    expect(third.body.items.map((i: { id: number }) => i.id)).toEqual([5]);
    expect(third.body.total).toBe(5);
  });

  it('answers a page past the end with an empty list, not an error', async () => {
    await seedProducts(redis(), [product({ id: 1 })]);

    const res = await request(app()).get('/api/products?page=9');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], total: 1, page: 9 });
  });

  it('answers an unknown category with an empty list', async () => {
    await seedProducts(redis(), [product({ id: 1 })]);

    const res = await request(app()).get('/api/products?category=Nothing');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], total: 0 });
  });

  it('carries the price and the promotion that produced it', async () => {
    await seedProducts(redis(), [
      product({
        id: 1,
        basePriceCents: 10_000,
        effectivePriceCents: 5_000,
        promotionId: 7,
        promotionName: 'Half off accessories',
      }),
    ]);

    const [item] = (await request(app()).get('/api/products')).body.items;

    expect(item).toMatchObject({
      id: 1,
      basePriceCents: 10_000,
      effectivePriceCents: 5_000,
      promotion: { id: 7, name: 'Half off accessories' },
    });
  });

  it('rejects a page size above the cap', async () => {
    await seedProducts(redis(), [product({ id: 1 })]);

    const res = await request(app()).get('/api/products?pageSize=101');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['a page of zero', '?page=0'],
    ['a negative page', '?page=-1'],
    ['a page that is not a number', '?page=abc'],
    ['an unknown sort', '?sort=name'],
    ['an unknown order', '?order=sideways'],
    ['an unknown parameter', '?colour=red'],
  ])('rejects %s', async (_case, query) => {
    await seedProducts(redis(), [product({ id: 1 })]);

    expect((await request(app()).get(`/api/products${query}`)).status).toBe(400);
  });
});

describe('GET /api/products/:id', () => {
  it('answers with the product, its prices and its promotion', async () => {
    await seedProducts(redis(), [
      product({
        id: 42,
        basePriceCents: 8_000,
        effectivePriceCents: 6_000,
        promotionId: 3,
        promotionName: 'Winter sale',
      }),
    ]);

    const res = await request(app()).get('/api/products/42');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 42,
      sku: 'SKU-42',
      category: 'Accessories',
      basePriceCents: 8_000,
      effectivePriceCents: 6_000,
      promotion: { id: 3, name: 'Winter sale' },
    });
  });

  it('reports no promotion as null rather than leaving the field out', async () => {
    await seedProducts(redis(), [product({ id: 1 })]);

    const res = await request(app()).get('/api/products/1');

    expect(res.body.promotion).toBeNull();
  });

  it('answers 404 for a product the read model does not hold', async () => {
    await seedProducts(redis(), [product({ id: 1 })]);

    const res = await request(app()).get('/api/products/999');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects an id that is not a number', async () => {
    await seedProducts(redis(), [product({ id: 1 })]);

    expect((await request(app()).get('/api/products/abc')).status).toBe(400);
  });
});

describe('a rebuild that has removed a product the index still lists', () => {
  it('serves the rest of the page rather than failing all of it', async () => {
    await seedProducts(redis(), [
      product({ id: 1, effectivePriceCents: 1_000 }),
      product({ id: 2, effectivePriceCents: 2_000 }),
    ]);
    // A scoped rebuild unlinks hashes while the sorted set still holds the
    // ids, so one absent member must not take the other 99 with it.
    await redis().unlink('product:1');

    const res = await request(app()).get('/api/products');

    expect(res.status).toBe(200);
    expect(res.body.items.map((item: { id: number }) => item.id)).toEqual([2]);
  });
});

describe('when Redis cannot be reached', () => {
  it('answers 503 with a retry hint rather than a server fault', async () => {
    const unreachable = new Redis({
      host: '127.0.0.1',
      port: 6390,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    unreachable.connect().catch(() => undefined);

    const res = await request(createApp({ redis: unreachable })).get('/api/products');
    unreachable.disconnect();

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('READ_MODEL_NOT_READY');
  });
});

describe('paging far past the end', () => {
  it('refuses an offset that would walk the whole index', async () => {
    await seedProducts(redis(), [product({ id: 1 })]);

    const res = await request(app()).get('/api/products?page=1000000');

    expect(res.status).toBe(400);
  });

  it('refuses a page given in exponent notation', async () => {
    await seedProducts(redis(), [product({ id: 1 })]);

    expect((await request(app()).get('/api/products?page=1e9')).status).toBe(400);
  });
});

describe('a product id that is not plainly a number', () => {
  it.each([
    ['hexadecimal', '0x2a'],
    ['exponent notation', '4.2e1'],
    ['padded with spaces', '%2042%20'],
  ])('refuses %s rather than serving one product under two URLs', async (_case, id) => {
    await seedProducts(redis(), [product({ id: 42 })]);

    expect((await request(app()).get(`/api/products/${id}`)).status).toBe(400);
  });
});

describe('a read-model entry the writer left incomplete', () => {
  it('fails loudly on the detail route rather than serving a price of zero', async () => {
    await seedProducts(redis(), [product({ id: 1 })]);
    await redis().hdel('product:1', 'effectivePriceCents');

    const res = await request(app()).get('/api/products/1');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });

  it('fails loudly on the listing too', async () => {
    await seedProducts(redis(), [product({ id: 1 })]);
    await redis().hdel('product:1', 'basePriceCents');

    expect((await request(app()).get('/api/products')).status).toBe(500);
  });
});

describe('before the read model is built', () => {
  it('answers 503 on the listing rather than reading PostgreSQL', async () => {
    const res = await request(app()).get('/api/products');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('READ_MODEL_NOT_READY');
    // A band, not a fixed number: a flat hint returns every client that met
    // the cold start in the same second.
    const after = Number(res.headers['retry-after']);
    expect(after).toBeGreaterThanOrEqual(5);
    expect(after).toBeLessThanOrEqual(10);
  });

  it('answers 503 on the detail route too', async () => {
    const res = await request(app()).get('/api/products/1');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('READ_MODEL_NOT_READY');
  });
});
