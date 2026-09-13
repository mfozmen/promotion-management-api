import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import createError from 'http-errors';
import { ProductReadModel } from '@src/modules/product/db/product-read-model.js';

const page = { order: 'asc', page: 1, pageSize: 20 } as const;

const hit = {
  id: '7',
  sku: 'SKU-7',
  name: 'Kazak',
  category: 'knitwear',
  basePriceCents: '10000',
  effectivePriceCents: '10000',
  stockQuantity: '3',
};

const replyError = (message: string) => Object.assign(new Error(message), { name: 'ReplyError' });

describe('ProductReadModel', () => {
  describe('find', () => {
    it('answers come back rather than server fault when Redis drops mid-request', async () => {
      const failure = Object.assign(new Error('Connection is closed.'), { code: 'ECONNRESET' });
      const redis = { hgetall: () => Promise.reject(failure) } as unknown as Redis;

      const raised = await new ProductReadModel(redis).find(7).catch((error: unknown) => error);

      expect(createError.isHttpError(raised)).toBe(true);
      expect((raised as createError.HttpError).status).toBe(503);
    });

    it('names the key when the writer put something else at it', async () => {
      const redis = {
        hgetall: () => Promise.reject(replyError('WRONGTYPE Operation against a key')),
      } as unknown as Redis;

      const raised = await new ProductReadModel(redis).find(7).catch((error: unknown) => error);

      expect((raised as Error).message).toContain('product:7');
      expect((raised as Error).name).toBe('ReplyError');
    });

    it('leaves a product the read model does not hold absent, so the route answers 404', async () => {
      const redis = { hgetall: () => Promise.resolve({}) } as unknown as Redis;

      await expect(new ProductReadModel(redis).find(7)).resolves.toBeUndefined();
    });

    it('costs one command on the hit path, which is the hottest in the system', async () => {
      const called: string[] = [];
      const redis = {
        hgetall: () => {
          called.push('hgetall');

          return Promise.resolve(hit);
        },
        zscore: () => {
          called.push('zscore');

          return Promise.resolve('9000');
        },
      } as unknown as Redis;

      await new ProductReadModel(redis).find(7);

      expect(called).toEqual(['hgetall']);
    });
  });

  describe('list', () => {
    it('answers come back rather than server fault when Redis drops mid-request', async () => {
      const failure = Object.assign(new Error('Connection is closed.'), { code: 'ECONNRESET' });
      const redis = {
        zrange: () => Promise.reject(failure),
        zcard: () => Promise.reject(failure),
        pipeline: () => ({ hgetall: () => undefined, exec: () => Promise.reject(failure) }),
      } as unknown as Redis;

      const raised = await new ProductReadModel(redis).list(page).catch((error: unknown) => error);

      expect(createError.isHttpError(raised)).toBe(true);
      expect((raised as createError.HttpError).cause).toBe(failure);
    });

    it('reads the failure a pipeline resolves with rather than waiting to be rejected', async () => {
      // Probed against the installed ioredis: `exec` resolves with
      // `[[Error, null]]` for a connection that has gone, and rejects only for
      // shapes this client cannot produce.
      const failure = new Error("Stream isn't writeable and enableOfflineQueue options is false");
      const redis = {
        zrange: () => Promise.resolve(['1']),
        zcard: () => Promise.resolve(1),
        pipeline: () => ({
          hgetall: () => undefined,
          exec: () => Promise.resolve([[failure, null]]),
        }),
      } as unknown as Redis;

      const raised = await new ProductReadModel(redis).list(page).catch((error: unknown) => error);

      expect((raised as createError.HttpError).status).toBe(503);
    });

    it('never names a key the caller composed, even on the branch that names keys', async () => {
      const wrongType = replyError('WRONGTYPE Operation against a key');
      const redis = {
        zrange: () => Promise.reject(wrongType),
        zcard: () => Promise.reject(wrongType),
        pipeline: () => ({ hgetall: () => undefined, exec: () => Promise.resolve([]) }),
      } as unknown as Redis;

      const raised = await new ProductReadModel(redis)
        .list({ ...page, category: 'boots at product:7' })
        .catch((error: unknown) => error);

      // A key existing with the wrong type is the writer's doing; the string
      // still came from the query parameter.
      expect((raised as Error).message).not.toContain('product:7');
      expect(raised).toBe(wrongType);
    });

    it('leaves a reply error a server fault, because the server answered', async () => {
      const wrongType = replyError('WRONGTYPE Operation against a key');
      const redis = {
        zrange: () => Promise.resolve(['1']),
        zcard: () => Promise.resolve(1),
        pipeline: () => ({
          hgetall: () => undefined,
          exec: () => Promise.resolve([[wrongType, null]]),
        }),
      } as unknown as Redis;

      const raised = await new ProductReadModel(redis).list(page).catch((error: unknown) => error);

      expect((raised as Error).name).toBe('ReplyError');
      expect((raised as Error).message).toContain('product:1');
    });

    it('leaves a malformed row a server fault, because that price is wrong rather than absent', async () => {
      const redis = {
        zrange: () => Promise.resolve(['1']),
        zcard: () => Promise.resolve(1),
        pipeline: () => ({
          hgetall: () => undefined,
          exec: () => Promise.resolve([[null, { id: '1', name: 'no prices here' }]]),
        }),
      } as unknown as Redis;

      const raised = await new ProductReadModel(redis).list(page).catch((error: unknown) => error);

      expect(createError.isHttpError(raised)).toBe(false);
    });

    it('does not read a property off something that is not an error', async () => {
      const redis = {
        zrange: () => Promise.reject('a string, somehow'),
        zcard: () => Promise.reject('a string, somehow'),
        pipeline: () => ({ hgetall: () => undefined, exec: () => Promise.resolve([]) }),
      } as unknown as Redis;

      const raised = await new ProductReadModel(redis).list(page).catch((error: unknown) => error);

      expect((raised as createError.HttpError).status).toBe(503);
    });
  });

  describe('isReady', () => {
    it('is false while the rebuild has published nothing', async () => {
      const redis = { exists: () => Promise.resolve(0) } as unknown as Redis;

      await expect(new ProductReadModel(redis).isReady()).resolves.toBe(false);
    });

    it('is true once the key exists', async () => {
      const redis = { exists: () => Promise.resolve(1) } as unknown as Redis;

      await expect(new ProductReadModel(redis).isReady()).resolves.toBe(true);
    });

    it('answers come back when the gate itself cannot reach Redis', async () => {
      const redis = { exists: () => Promise.reject(new Error('closed')) } as unknown as Redis;

      const raised = await new ProductReadModel(redis).isReady().catch((error: unknown) => error);

      expect((raised as createError.HttpError).status).toBe(503);
    });
  });

  describe('the keys', () => {
    it("are the model's own spelling, so a test cannot keep a second copy", () => {
      expect(ProductReadModel.productKey(7)).toBe('product:7');
      expect(ProductReadModel.categoryKey('knitwear')).toBe('category:knitwear');
      expect(ProductReadModel.ALL_PRODUCTS).toBe('products:all');
      expect(ProductReadModel.READY_KEY).toBe('readmodel:ready');
    });
  });
});
