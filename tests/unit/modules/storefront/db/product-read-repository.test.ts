import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import createError from 'http-errors';
import { ProductReadRepository } from '@src/modules/storefront/db/product-read-repository.js';

const replyError = (message: string) => Object.assign(new Error(message), { name: 'ReplyError' });

describe('ProductReadRepository', () => {
  describe('the keys', () => {
    it("are the model's own spelling, so nothing else keeps a second copy", () => {
      expect(ProductReadRepository.productKey(7)).toBe('product:7');
      expect(ProductReadRepository.categoryKey('knitwear')).toBe('category:knitwear');
      expect(ProductReadRepository.ALL_PRODUCTS).toBe('products:all');
      expect(ProductReadRepository.READY_KEY).toBe('readmodel:ready');
    });
  });

  describe('ping', () => {
    it('asks Redis to answer, which no other method here can tell from an empty store', async () => {
      const redis = { ping: () => Promise.resolve('PONG') } as unknown as Redis;

      await expect(new ProductReadRepository(redis).ping()).resolves.toBeUndefined();
    });

    it('lets an unreachable store raise, so the caller reports down rather than empty', async () => {
      const redis = { ping: () => Promise.reject(new Error('refused')) } as unknown as Redis;

      await expect(new ProductReadRepository(redis).ping()).rejects.toThrow('refused');
    });
  });

  describe('isReady', () => {
    it('is false while the rebuild has published nothing', async () => {
      const redis = { exists: () => Promise.resolve(0) } as unknown as Redis;

      await expect(new ProductReadRepository(redis).isReady()).resolves.toBe(false);
    });

    it('is true once the key exists', async () => {
      const redis = { exists: () => Promise.resolve(1) } as unknown as Redis;

      await expect(new ProductReadRepository(redis).isReady()).resolves.toBe(true);
    });
  });

  describe('a failed command', () => {
    it('is a reason to come back when the store did not answer', async () => {
      const failure = Object.assign(new Error('Connection is closed.'), { code: 'ECONNRESET' });
      const redis = { hgetall: () => Promise.reject(failure) } as unknown as Redis;

      const raised = await new ProductReadRepository(redis)
        .find(7)
        .catch((error: unknown) => error);

      expect((raised as createError.HttpError).status).toBe(503);
      expect((raised as createError.HttpError).cause).toBe(failure);
    });

    it("is the writer's mistake when the server answered WRONGTYPE, and names our key", async () => {
      const redis = {
        hgetall: () => Promise.reject(replyError('WRONGTYPE Operation against a key')),
      } as unknown as Redis;

      const raised = await new ProductReadRepository(redis)
        .find(7)
        .catch((error: unknown) => error);

      expect(createError.isHttpError(raised)).toBe(false);
      expect((raised as Error).message).toContain('product:7');
    });

    it('names the key it composed when a count is wrong-typed', async () => {
      const redis = {
        zcard: () => Promise.reject(replyError('WRONGTYPE Operation against a key')),
      } as unknown as Redis;

      const raised = await new ProductReadRepository(redis)
        .count('boots')
        .catch((error: unknown) => error);

      expect((raised as Error).message).toContain('category:boots');
    });

    it('is a reason to come back when the rejection is not an error at all', async () => {
      const redis = { zcard: () => Promise.reject('a string, somehow') } as unknown as Redis;

      const raised = await new ProductReadRepository(redis)
        .count()
        .catch((error: unknown) => error);

      expect((raised as createError.HttpError).status).toBe(503);
    });
  });

  describe('findAll', () => {
    it('reads the failure a pipeline resolves with rather than waiting to be rejected', async () => {
      // Probed against the installed ioredis: `exec` resolves with
      // `[[Error, null]]` for a connection that has gone, and rejects only for
      // shapes this client cannot produce.
      const failure = new Error("Stream isn't writeable and enableOfflineQueue options is false");
      const redis = {
        pipeline: () => ({
          hgetall: () => undefined,
          exec: () => Promise.resolve([[failure, null]]),
        }),
      } as unknown as Redis;

      const raised = await new ProductReadRepository(redis)
        .findAll(['1'])
        .catch((error: unknown) => error);

      expect((raised as createError.HttpError).status).toBe(503);
    });

    it('names the product a wrong-typed reply came from', async () => {
      const redis = {
        pipeline: () => ({
          hgetall: () => undefined,
          exec: () => Promise.resolve([[replyError('WRONGTYPE Operation against a key'), null]]),
        }),
      } as unknown as Redis;

      const raised = await new ProductReadRepository(redis)
        .findAll(['1'])
        .catch((error: unknown) => error);

      expect((raised as Error).message).toContain('product:1');
    });

    it('treats a product the pipeline answered nothing for as an absent entry', async () => {
      const redis = {
        pipeline: () => ({ hgetall: () => undefined, exec: () => Promise.resolve([]) }),
      } as unknown as Redis;

      await expect(new ProductReadRepository(redis).findAll(['1', '2'])).resolves.toEqual([
        undefined,
        undefined,
      ]);
    });

    it('answers an empty list for an empty page rather than a null', async () => {
      const redis = {
        pipeline: () => ({ hgetall: () => undefined, exec: () => Promise.resolve(null) }),
      } as unknown as Redis;

      await expect(new ProductReadRepository(redis).findAll([])).resolves.toEqual([]);
    });
  });

  describe('page', () => {
    it('asks Redis for the maximum first when the order is descending', async () => {
      const seen: unknown[][] = [];
      const redis = {
        zrange: (...args: unknown[]) => {
          seen.push(args);

          return Promise.resolve([]);
        },
      } as unknown as Redis;

      await new ProductReadRepository(redis).page({ order: 'desc', offset: 0, size: 20 });

      expect(seen[0]).toContain('REV');
      expect(seen[0]?.[1]).toBe('+inf');
    });
  });
});
