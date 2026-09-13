import { Redis } from 'ioredis';
import { ALL_PRODUCTS } from '@src/modules/product/db/all-products-key.js';
import { categoryKey } from '@src/modules/product/db/category-key.js';
import { productKey } from '@src/modules/product/db/product-key.js';
import { READY_KEY } from '@src/modules/product/db/ready-key.js';
import { afterAll, beforeAll, beforeEach } from 'vitest';

/**
 * A logical database of its own, so a run cannot disturb the read model or the
 * queue a developer is using, and the keys can be cleared between tests by
 * prefix rather than with FLUSHDB (REVIEW.md 5.3).
 */
const url = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/9';

export function useTestRedis(): () => Redis {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(url);
  });

  beforeEach(async () => {
    // SCAN, never KEYS: the rule that forbids KEYS in a code path does not
    // stop applying because this one is a test (REVIEW.md 5.3).
    const doomed: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await redis.scan(cursor, 'COUNT', 500);
      cursor = next;
      doomed.push(...batch);
    } while (cursor !== '0');
    if (doomed.length > 0) await redis.unlink(...doomed);
  });

  afterAll(async () => {
    await redis.quit();
  });

  return () => redis;
}

export type SeedProduct = {
  id: number;
  sku: string;
  name: string;
  category: string;
  basePriceCents: number;
  effectivePriceCents: number;
  stockQuantity: number;
  promotionId?: number;
  promotionName?: string;
};

/** Writes the keys the read-model worker of #12 will write, as spec §5 documents them. */
export async function seedProducts(redis: Redis, products: readonly SeedProduct[]): Promise<void> {
  const pipeline = redis.pipeline();
  for (const product of products) {
    pipeline.hset(productKey(product.id), {
      id: String(product.id),
      sku: product.sku,
      name: product.name,
      category: product.category,
      basePriceCents: String(product.basePriceCents),
      effectivePriceCents: String(product.effectivePriceCents),
      stockQuantity: String(product.stockQuantity),
      ...(product.promotionId === undefined
        ? {}
        : { promotionId: String(product.promotionId), promotionName: product.promotionName ?? '' }),
      ingestionRulesVersion: '1789238046',
      updatedAt: '2026-09-12T00:00:00.000Z',
    });
    pipeline.zadd(categoryKey(product.category), product.effectivePriceCents, String(product.id));
    pipeline.zadd(ALL_PRODUCTS, product.effectivePriceCents, String(product.id));
  }
  pipeline.set(READY_KEY, '1');
  await pipeline.exec();
}
