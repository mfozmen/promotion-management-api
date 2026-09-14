import { describe, expect, it } from 'vitest';
import { ProductReadRepository } from '@src/modules/storefront/db/product-read-repository.js';
import { ProductSourceRepository } from '@src/modules/storefront/db/product-source-repository.js';
import { ProductWriteRepository } from '@src/modules/storefront/db/product-write-repository.js';
import type { ProductEntry } from '@src/modules/storefront/domain/dto/product-entry.js';
import { ProductUpsertedHandler } from '@src/modules/storefront/events/product-upserted-handler.js';
import { products } from '@src/modules/product/db/schema/products.js';
import { promotions } from '@src/modules/promotion/db/schema/promotions.js';
import { pricingRules } from '@src/modules/pricing/db/schema/pricing-rules.js';
import { PromotionResolver } from '@src/modules/promotion/domain/promotion-resolver.js';
import { EffectivePriceCalculator } from '@src/modules/promotion/domain/effective-price-calculator.js';
import { ProductPricer } from '@src/modules/storefront/domain/product-pricer.js';
import { pino } from 'pino';
import { useTestDatabase } from '../../../db.js';
import { TEST_DATABASE, useTestRedis } from '../../../redis.js';

const db = useTestDatabase();
const redis = useTestRedis(TEST_DATABASE.productUpsertedHandler);

// A category per test: an active category promotion is all-time to the
// exclusion constraints and visible to every product that shares the name.
async function insert(sku: string, category = 'knitwear'): Promise<number> {
  const [inserted] = await db()
    .insert(products)
    .values({
      sku,
      name: `Product ${sku}`,
      category,
      basePriceCents: 10_000,
      stockQuantity: 5,
    })
    .returning({ id: products.id });

  return inserted!.id;
}

const entry = (id: number, over: Partial<ProductEntry> = {}): ProductEntry => ({
  id,
  sku: `SKU-${String(id)}`,
  name: `Product ${String(id)}`,
  category: 'knitwear',
  basePriceCents: 10_000,
  effectivePriceCents: 10_000,
  stockQuantity: 5,
  ...over,
});

/** The seeded policy, not a fixture: this is the one path where PostgreSQL's
 *  rows, the promotion rules and the Redis entry meet. */
async function handler(): Promise<ProductUpsertedHandler> {
  const logger = pino({ level: 'silent' });
  const rules = await db().select().from(pricingRules);

  return new ProductUpsertedHandler(
    new ProductSourceRepository(db()),
    new ProductWriteRepository(redis()),
    new ProductPricer(
      await PromotionResolver.fromRules(rules, logger),
      new EffectivePriceCalculator(),
      logger,
    ),
    logger,
  );
}

describe('ProductUpsertedHandler against both stores', () => {
  it('is born discounted when its category is already on sale', async () => {
    const id = await insert('SKU-P4', 'coats');
    await db()
      .insert(promotions)
      .values({
        name: 'Half off coats',
        discountType: 'percentage',
        value: 5_000,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3_600_000),
        category: 'coats',
        status: 'active',
      });

    await (await handler()).handle({ productIds: [id] });

    // The whole of #114 in one assertion: PostgreSQL's rows, the seeded policy
    // and the entry a shopper would be served.
    expect(await new ProductReadRepository(redis()).find(id)).toMatchObject({
      effectivePriceCents: '5000',
      promotionName: 'Half off coats',
    });
    expect(await redis().zscore(ProductReadRepository.ALL_PRODUCTS, String(id))).toBe('5000');
  });

  it('writes what PostgreSQL holds, ordered by the token PostgreSQL rendered', async () => {
    const id = await insert('SKU-P1');

    await (await handler()).handle({ productIds: [id] });

    expect(await new ProductReadRepository(redis()).find(id)).toMatchObject({
      sku: 'SKU-P1',
      effectivePriceCents: '10000',
    });
  });

  it('orders two real reads against each other, which an invented token cannot prove', async () => {
    const id = await insert('SKU-P2');
    const source = new ProductSourceRepository(db());
    const write = new ProductWriteRepository(redis());

    // Two instants from the same clock in the order the database produced them:
    // the compare-and-set is only sound if it rejects the older of the two.
    const earlier = (await source.read([id])).sourceReadAt;
    const later = (await source.read([id])).sourceReadAt;

    expect(await write.write(entry(id, { effectivePriceCents: 8_000 }), later)).toBe(true);
    expect(await write.write(entry(id, { effectivePriceCents: 5_000 }), earlier)).toBe(false);
    expect(await redis().zscore(ProductReadRepository.ALL_PRODUCTS, String(id))).toBe('8000');
  });

  it('tombstones an id PostgreSQL no longer holds without freezing it out', async () => {
    const id = await insert('SKU-P3');
    await (await handler()).handle({ productIds: [id] });

    await db().delete(products);
    await (await handler()).handle({ productIds: [id] });

    expect(await new ProductReadRepository(redis()).find(id)).toBeUndefined();
    // The empty batch takes its instant from the same clock, so a later write
    // still outranks the tombstone rather than being locked out for good.
    const fresh = (await new ProductSourceRepository(db()).read([id])).sourceReadAt;
    expect(await new ProductWriteRepository(redis()).write(entry(id), fresh)).toBe(true);
  });
});
