import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { ProductReadRepository } from '@src/modules/storefront/db/product-read-repository.js';
import { ProductSourceRepository } from '@src/modules/storefront/db/product-source-repository.js';
import { ProductWriteRepository } from '@src/modules/storefront/db/product-write-repository.js';
import { ProductUpsertedHandler } from '@src/modules/storefront/events/product-upserted-handler.js';
import { ProductPricer } from '@src/modules/storefront/domain/product-pricer.js';
import { RebuildReadModelCommand } from '@src/modules/storefront/commands/rebuild-read-model-command.js';
import { PromotionResolver } from '@src/modules/promotion/domain/promotion-resolver.js';
import { EffectivePriceCalculator } from '@src/modules/promotion/domain/effective-price-calculator.js';
import { pricingRules } from '@src/modules/pricing/db/schema/pricing-rules.js';
import { products } from '@src/modules/product/db/schema/products.js';
import { useTestDatabase } from '../../../db.js';
import { TEST_DATABASE, useTestRedis } from '../../../redis.js';

const db = useTestDatabase();
const redis = useTestRedis(TEST_DATABASE.readModelRebuild);
const logger = pino({ level: 'silent' });

async function insert(sku: string, category = 'knitwear'): Promise<number> {
  const [inserted] = await db()
    .insert(products)
    .values({ sku, name: `Product ${sku}`, category, basePriceCents: 10_000, stockQuantity: 5 })
    .returning({ id: products.id });

  return inserted!.id;
}

async function rebuild(): Promise<RebuildReadModelCommand> {
  const rules = await db().select().from(pricingRules);
  const source = new ProductSourceRepository(db());
  const write = new ProductWriteRepository(redis());
  const pricer = new ProductPricer(
    await PromotionResolver.fromRules(rules, logger),
    new EffectivePriceCalculator(),
    logger,
  );

  return new RebuildReadModelCommand(
    source,
    new ProductUpsertedHandler(source, write, pricer, logger),
    redis(),
    logger,
  );
}

describe('RebuildReadModelCommand', () => {
  it('builds the catalogue from PostgreSQL and only then opens the storefront', async () => {
    const one = await insert('SKU-R1');
    const two = await insert('SKU-R2');
    const read = new ProductReadRepository(redis());

    expect(await read.isReady()).toBe(false);
    await (await rebuild()).rebuildAll();

    expect(await read.find(one)).toMatchObject({ sku: 'SKU-R1', effectivePriceCents: '10000' });
    expect(await read.find(two)).toBeDefined();
    expect(await read.isReady()).toBe(true);
  });

  it('rebuilds on boot only when nothing has published the read model', async () => {
    const one = await insert('SKU-R8');

    await expect((await rebuild()).rebuildUnlessReady()).resolves.toBe(true);
    await db().update(products).set({ basePriceCents: 4_000 });

    // A warm read model is not rebuilt by a restart, and restarts are routine.
    await expect((await rebuild()).rebuildUnlessReady()).resolves.toBe(false);
    expect(await new ProductReadRepository(redis()).find(one)).toMatchObject({
      basePriceCents: '10000',
    });
  });

  it('drops an entry with nothing behind it, and leaves its tombstone', async () => {
    const gone = await insert('SKU-R3');
    await (await rebuild()).rebuildAll();
    await db().delete(products);

    await (await rebuild()).rebuildAll();

    const read = new ProductReadRepository(redis());
    expect(await read.find(gone)).toBeUndefined();
    expect(await redis().zscore(ProductReadRepository.ALL_PRODUCTS, String(gone))).toBeNull();
    // The token outlives the entry, so a recompute in flight from before the
    // rebuild cannot resurrect it.
    expect(await redis().hget(ProductWriteRepository.TOKENS, String(gone))).not.toBeNull();
  });

  it('never empties the database it shares, only the keys it owns', async () => {
    await insert('SKU-R4');
    await redis().set('someone:else', 'untouched');

    await (await rebuild()).rebuildAll();

    expect(await redis().get('someone:else')).toBe('untouched');
  });

  it('rewrites one category without touching another', async () => {
    const knit = await insert('SKU-R5', 'knitwear');
    const coat = await insert('SKU-R6', 'coats');
    await (await rebuild()).rebuildAll();
    await db().update(products).set({ basePriceCents: 4_000 });

    await (await rebuild()).rebuildCategory('knitwear');

    const read = new ProductReadRepository(redis());
    expect(await read.find(knit)).toMatchObject({ basePriceCents: '4000' });
    expect(await read.find(coat)).toMatchObject({ basePriceCents: '10000' });
  });

  it('recomputes a product in the category once, not once per pass', async () => {
    const stays = await insert('SKU-R9', 'hats');
    await (await rebuild()).rebuildAll();
    const counted: number[] = [];
    const source = new ProductSourceRepository(db());
    const recompute = {
      handle: ({ productIds }: { productIds: number[] }) => {
        counted.push(...productIds);
        return Promise.resolve();
      },
    };

    await new RebuildReadModelCommand(source, recompute, redis(), logger).rebuildCategory('hats');

    // The sorted set lists what the source pass just wrote; rebuilding a
    // 50 000-product category twice doubles the slowest thing there is.
    expect(counted).toEqual([stays]);
  });

  it('moves a product the scoped rebuild finds in the wrong category', async () => {
    const moved = await insert('SKU-R7', 'knitwear');
    await (await rebuild()).rebuildAll();
    await db().update(products).set({ category: 'coats' });

    // The sorted set still lists it, which is how a scoped rebuild finds a
    // product that left the category it is rebuilding.
    await (await rebuild()).rebuildCategory('knitwear');

    expect(
      await redis().zscore(ProductReadRepository.categoryKey('knitwear'), String(moved)),
    ).toBeNull();
    expect(await redis().zscore(ProductReadRepository.categoryKey('coats'), String(moved))).toBe(
      '10000',
    );
  });
});
