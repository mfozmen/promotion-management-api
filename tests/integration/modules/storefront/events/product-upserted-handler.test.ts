import { describe, expect, it } from 'vitest';
import { ProductReadRepository } from '@src/modules/storefront/db/product-read-repository.js';
import { ProductSourceRepository } from '@src/modules/storefront/db/product-source-repository.js';
import {
  ProductWriteRepository,
  type ProductEntry,
} from '@src/modules/storefront/db/product-write-repository.js';
import { ProductUpsertedHandler } from '@src/modules/storefront/events/product-upserted-handler.js';
import { products } from '@src/modules/product/db/schema/products.js';
import { pino } from 'pino';
import { useTestDatabase } from '../../../db.js';
import { useTestRedis } from '../../../redis.js';

const db = useTestDatabase();
const redis = useTestRedis();

async function insert(sku: string): Promise<number> {
  const [inserted] = await db()
    .insert(products)
    .values({
      sku,
      name: `Product ${sku}`,
      category: 'knitwear',
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

function handler(): ProductUpsertedHandler {
  return new ProductUpsertedHandler(
    new ProductSourceRepository(db()),
    new ProductWriteRepository(redis()),
    pino({ level: 'silent' }),
  );
}

describe('ProductUpsertedHandler against both stores', () => {
  it('writes what PostgreSQL holds, ordered by the token PostgreSQL rendered', async () => {
    const id = await insert('SKU-P1');

    await handler().handle({ productIds: [id] });

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
    await handler().handle({ productIds: [id] });

    await db().delete(products);
    await handler().handle({ productIds: [id] });

    expect(await new ProductReadRepository(redis()).find(id)).toBeUndefined();
    // The empty batch takes its instant from the same clock, so a later write
    // still outranks the tombstone rather than being locked out for good.
    const fresh = (await new ProductSourceRepository(db()).read([id])).sourceReadAt;
    expect(await new ProductWriteRepository(redis()).write(entry(id), fresh)).toBe(true);
  });
});
