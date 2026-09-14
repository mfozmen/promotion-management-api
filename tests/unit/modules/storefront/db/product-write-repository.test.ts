import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { ProductWriteRepository } from '@src/modules/storefront/db/product-write-repository.js';

const entry = {
  id: 1,
  sku: 'SKU-1',
  name: 'Kazak',
  category: 'knitwear',
  basePriceCents: 10_000,
  effectivePriceCents: 10_000,
  stockQuantity: 5,
};

function clientWhosePipeline(exec: () => Promise<unknown>): Redis {
  return {
    defineCommand: () => undefined,
    pipeline: () => ({ writeProductEntry: () => undefined, exec }),
  } as unknown as Redis;
}

describe('ProductWriteRepository', () => {
  it('raises the reply error a script in the middle of a pipeline answered with', async () => {
    // Probed against the installed ioredis: `exec` resolves with each reply's
    // error rather than rejecting, so nothing else would ever see this.
    const failure = Object.assign(new Error('NOSCRIPT No matching script'), {
      name: 'ReplyError',
    });
    const redis = clientWhosePipeline(() => Promise.resolve([[failure, null]]));

    await expect(new ProductWriteRepository(redis).write(entry, '1789380000000000')).rejects.toBe(
      failure,
    );
  });

  it('answers nothing applied when ioredis answers a null reply list', async () => {
    // `exec` is typed nullable for a transaction a WATCH aborted, and a
    // pipeline has no WATCH.
    const redis = clientWhosePipeline(() => Promise.resolve(null));

    await expect(
      new ProductWriteRepository(redis).writeAll([entry], '1789380000000000'),
    ).resolves.toEqual([]);
  });
});
