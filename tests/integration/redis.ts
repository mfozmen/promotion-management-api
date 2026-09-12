import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach } from 'vitest';

/**
 * A logical database of its own, so a run cannot disturb the read model or the
 * queue a developer is using, and the keys can be cleared between tests by
 * prefix rather than with FLUSHDB (REVIEW.md 5.3).
 */
const url = process.env.TEST_REDIS_URL ?? 'redis://localhost:6399/9';

export function useTestRedis(): () => Redis {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(url);
  });

  beforeEach(async () => {
    for (const prefix of ['product:', 'category:', 'products:all', 'readmodel:ready']) {
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length > 0) await redis.unlink(...keys);
    }
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
    pipeline.hset(`product:${product.id}`, {
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
      pricingRulesVersion: '1789238046',
      updatedAt: '2026-09-12T00:00:00.000Z',
    });
    pipeline.zadd(`category:${product.category}`, product.effectivePriceCents, String(product.id));
    pipeline.zadd('products:all', product.effectivePriceCents, String(product.id));
  }
  pipeline.set('readmodel:ready', '1');
  await pipeline.exec();
}
