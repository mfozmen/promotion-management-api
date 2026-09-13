import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { findProduct } from '@src/modules/product/db/find-product.js';
import { HttpError } from '@src/shared/http/http-error.js';

describe('findProduct', () => {
  it('answers come back rather than server fault when Redis drops mid-request', async () => {
    const failure = Object.assign(new Error('Connection is closed.'), { code: 'ECONNRESET' });
    const redis = { hgetall: () => Promise.reject(failure) } as unknown as Redis;

    const raised = await findProduct(redis, 7).catch((error: unknown) => error);

    expect(raised).toBeInstanceOf(HttpError);
    expect((raised as HttpError).code).toBe('READ_MODEL_NOT_READY');
  });

  it('names the key when the writer put something else at it', async () => {
    const wrongType = Object.assign(new Error('WRONGTYPE Operation against a key'), {
      name: 'ReplyError',
    });
    const redis = { hgetall: () => Promise.reject(wrongType) } as unknown as Redis;

    const raised = await findProduct(redis, 7).catch((error: unknown) => error);

    expect((raised as Error).message).toContain('product:7');
  });

  it('calls a product the index still lists a rebuild, not a missing product', async () => {
    // The listing drops this member and calls it a rebuild in progress. The
    // detail route answered 404, which a crawler and a CDN both cache, for a
    // product that exists.
    const redis = {
      hgetall: () => Promise.resolve({}),
      zscore: () => Promise.resolve('1999'),
    } as unknown as Redis;

    const raised = await findProduct(redis, 7).catch((error: unknown) => error);

    expect((raised as HttpError).code).toBe('READ_MODEL_NOT_READY');
  });

  it('leaves a product no index lists absent, so the route can answer 404', async () => {
    const redis = {
      hgetall: () => Promise.resolve({}),
      zscore: () => Promise.resolve(null),
    } as unknown as Redis;

    await expect(findProduct(redis, 7)).resolves.toBeUndefined();
  });

  it('costs one command on the hit path, which is the hottest in the system', async () => {
    const called: string[] = [];
    const redis = {
      hgetall: () => {
        called.push('hgetall');

        return Promise.resolve({
          id: '7',
          sku: 'SKU-7',
          name: 'Kazak',
          category: 'knitwear',
          basePriceCents: '10000',
          effectivePriceCents: '10000',
          stockQuantity: '3',
        });
      },
      zscore: () => {
        called.push('zscore');

        return Promise.resolve('9000');
      },
    } as unknown as Redis;

    await findProduct(redis, 7);

    expect(called).toEqual(['hgetall']);
  });
});
