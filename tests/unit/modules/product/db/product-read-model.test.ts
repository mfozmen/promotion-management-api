import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import createError from 'http-errors';
import { ProductReadModel } from '@src/modules/product/db/product-read-model.js';

const replyError = (message: string) => Object.assign(new Error(message), { name: 'ReplyError' });

describe('ProductReadModel', () => {
  describe('the keys', () => {
    it("are the model's own spelling, so nothing else keeps a second copy", () => {
      expect(ProductReadModel.productKey(7)).toBe('product:7');
      expect(ProductReadModel.categoryKey('knitwear')).toBe('category:knitwear');
      expect(ProductReadModel.ALL_PRODUCTS).toBe('products:all');
      expect(ProductReadModel.READY_KEY).toBe('readmodel:ready');
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
  });

  describe('a failed command', () => {
    it('is a reason to come back when the store did not answer', async () => {
      const failure = Object.assign(new Error('Connection is closed.'), { code: 'ECONNRESET' });
      const redis = { hgetall: () => Promise.reject(failure) } as unknown as Redis;

      const raised = await new ProductReadModel(redis).hash(7).catch((error: unknown) => error);

      expect((raised as createError.HttpError).status).toBe(503);
      expect((raised as createError.HttpError).cause).toBe(failure);
    });

    it("is the writer's mistake when the server answered WRONGTYPE, and names our key", async () => {
      const redis = {
        hgetall: () => Promise.reject(replyError('WRONGTYPE Operation against a key')),
      } as unknown as Redis;

      const raised = await new ProductReadModel(redis).hash(7).catch((error: unknown) => error);

      expect(createError.isHttpError(raised)).toBe(false);
      expect((raised as Error).message).toContain('product:7');
    });

    it('never names a key a caller handed in, even on the branch that names keys', async () => {
      const wrongType = replyError('WRONGTYPE Operation against a key');
      const redis = { zcard: () => Promise.reject(wrongType) } as unknown as Redis;

      const raised = await new ProductReadModel(redis)
        .count('category:boots at product:7')
        .catch((error: unknown) => error);

      expect((raised as Error).message).not.toContain('product:7');
      expect(raised).toBe(wrongType);
    });

    it('is a reason to come back when the rejection is not an error at all', async () => {
      const redis = { zcard: () => Promise.reject('a string, somehow') } as unknown as Redis;

      const raised = await new ProductReadModel(redis)
        .count('products:all')
        .catch((error: unknown) => error);

      expect((raised as createError.HttpError).status).toBe(503);
    });
  });

  describe('hashes', () => {
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

      const raised = await new ProductReadModel(redis)
        .hashes(['1'])
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

      const raised = await new ProductReadModel(redis)
        .hashes(['1'])
        .catch((error: unknown) => error);

      expect((raised as Error).message).toContain('product:1');
    });

    it('answers an empty list for an empty page rather than a null', async () => {
      const redis = {
        pipeline: () => ({ hgetall: () => undefined, exec: () => Promise.resolve(null) }),
      } as unknown as Redis;

      await expect(new ProductReadModel(redis).hashes([])).resolves.toEqual([]);
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

      await new ProductReadModel(redis).page('products:all', 'desc', 0, 20);

      expect(seen[0]).toContain('REV');
      expect(seen[0]?.[1]).toBe('+inf');
    });
  });
});
