import { Redis } from 'ioredis';
import { ProductReadRepository } from '@src/modules/storefront/db/product-read-repository.js';
import { afterAll, beforeAll, beforeEach } from 'vitest';

// The test store compose brings up, not the development one: sharing a server with
// `npm run dev` works until someone runs both, and `localhost` resolves to `::1`
// while the port is published on IPv4 only.
const url = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6399/9';

/** One logical database per file, because files run in parallel forks and the
 *  flush below empties the whole of whichever it is pointed at. A second file on
 *  a number already here would delete the first one's keys mid-test, which fails
 *  a different test on every run. Redis serves 16. */
export const TEST_DATABASE = {
  productReadRoutes: 9,
  productWriteRepository: 10,
  productUpsertedHandler: 11,
  readModelRebuild: 12,
} as const;

export function useTestRedis(database: number): () => Redis {
  let redis: Redis;

  beforeAll(() => {
    const target = new URL(url);
    target.pathname = `/${String(database)}`;
    redis = new Redis(target.toString());
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
