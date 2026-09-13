import { Redis } from 'ioredis';
import { ProductReadRepository } from '@src/modules/storefront/db/product-read-repository.js';
import { afterAll, beforeAll, beforeEach } from 'vitest';

/** A logical database of its own, so a run cannot disturb the read model or
 *  the queue a developer is using. */
const url = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/9';

export function useTestRedis(): () => Redis {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(url);
  });

  beforeEach(async () => {
    // SCAN, never KEYS: what is forbidden in a code path is forbidden here.
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

/** The promotion is a pair or it is absent, the way the read model stores it,
 *  so a seed cannot write half of one and certify a shape the reader refuses. */
export type SeedPromotion =
  | { promotionId?: undefined; promotionName?: undefined }
  | { promotionId: number; promotionName: string };

export type SeedFields = {
  id: number;
  sku: string;
  name: string;
  category: string;
  basePriceCents: number;
  effectivePriceCents: number;
  stockQuantity: number;
};

export type SeedProduct = SeedFields & SeedPromotion;

/** Writes the keys the read-model worker will write, as the design documents them. */
export async function seedProducts(redis: Redis, products: readonly SeedProduct[]): Promise<void> {
  const pipeline = redis.pipeline();
  for (const product of products) {
    pipeline.hset(ProductReadRepository.productKey(product.id), {
      id: String(product.id),
      sku: product.sku,
      name: product.name,
      category: product.category,
      basePriceCents: String(product.basePriceCents),
      effectivePriceCents: String(product.effectivePriceCents),
      stockQuantity: String(product.stockQuantity),
      ...(product.promotionId === undefined
        ? {}
        : { promotionId: String(product.promotionId), promotionName: product.promotionName }),
      pricingRulesVersion: '1789238046',
      updatedAt: '2026-09-12T00:00:00.000Z',
    });
    pipeline.zadd(
      ProductReadRepository.categoryKey(product.category),
      product.effectivePriceCents,
      String(product.id),
    );
    pipeline.zadd(
      ProductReadRepository.ALL_PRODUCTS,
      product.effectivePriceCents,
      String(product.id),
    );
  }
  pipeline.set(ProductReadRepository.READY_KEY, '1');
  await pipeline.exec();
}
