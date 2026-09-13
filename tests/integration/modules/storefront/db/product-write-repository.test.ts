import { beforeEach, describe, expect, it } from 'vitest';
import { ProductReadRepository } from '@src/modules/storefront/db/product-read-repository.js';
import {
  ProductWriteRepository,
  type ProductEntry,
} from '@src/modules/storefront/db/product-write-repository.js';
import { useTestRedis } from '../../../redis.js';

const redis = useTestRedis();

const entry = (over: Partial<ProductEntry> = {}): ProductEntry => ({
  id: 1,
  sku: 'SKU-1',
  name: 'Kazak',
  category: 'knitwear',
  basePriceCents: 10_000,
  effectivePriceCents: 10_000,
  stockQuantity: 5,
  ...over,
});

/** PostgreSQL hands these back as `clock_timestamp()`; the ordering that matters
 *  is string ordering on the ISO form, which is why the column is read as text. */
const EARLY = '2026-09-14T10:00:00.000000+00:00';
const LATER = '2026-09-14T10:00:01.000000+00:00';

describe('ProductWriteRepository', () => {
  let write: ProductWriteRepository;
  let read: ProductReadRepository;

  beforeEach(() => {
    write = new ProductWriteRepository(redis());
    read = new ProductReadRepository(redis());
  });

  it('writes the hash and both sorted sets together', async () => {
    expect(await write.write(entry(), EARLY)).toBe(true);

    expect(await read.find(1)).toMatchObject({
      id: '1',
      sku: 'SKU-1',
      effectivePriceCents: '10000',
    });
    expect(await redis().zscore(ProductReadRepository.ALL_PRODUCTS, '1')).toBe('10000');
    expect(await redis().zscore(ProductReadRepository.categoryKey('knitwear'), '1')).toBe('10000');
  });

  it('applies a recompute that read PostgreSQL later', async () => {
    await write.write(entry(), EARLY);

    expect(await write.write(entry({ effectivePriceCents: 8_000 }), LATER)).toBe(true);
    expect(await redis().zscore(ProductReadRepository.ALL_PRODUCTS, '1')).toBe('8000');
  });

  it('refuses a recompute that read PostgreSQL earlier, so the newer decision stands', async () => {
    await write.write(entry({ effectivePriceCents: 8_000 }), LATER);

    // The cancel read at LATER and won; a boundary job still in flight read at
    // EARLY and would otherwise republish the sale price it saw.
    expect(await write.write(entry({ effectivePriceCents: 5_000 }), EARLY)).toBe(false);
    expect(await redis().zscore(ProductReadRepository.ALL_PRODUCTS, '1')).toBe('8000');
  });

  it('refuses an equal token, because that recompute saw the same rows', async () => {
    await write.write(entry(), EARLY);

    expect(await write.write(entry({ effectivePriceCents: 1 }), EARLY)).toBe(false);
  });

  it('leaves no field of an older entry behind when a newer one omits it', async () => {
    await write.write(entry({ promotionId: 7, promotionName: 'Winter sale' }), EARLY);

    await write.write(entry(), LATER);

    const hash = await read.find(1);
    expect(hash).not.toHaveProperty('promotionId');
    expect(hash).not.toHaveProperty('promotionName');
  });

  it('moves a product between categories without leaving the old score behind', async () => {
    await write.write(entry({ category: 'knitwear' }), EARLY);

    await write.write(entry({ category: 'coats' }), LATER);

    expect(await redis().zscore(ProductReadRepository.categoryKey('coats'), '1')).toBe('10000');
    // The old category still scores it: this write only knows the new one.
    // Nothing clears that membership today — no worker consumes
    // `reconciler.run` — so the product is listed under both categories until
    // one is written.
    expect(await redis().zscore(ProductReadRepository.categoryKey('knitwear'), '1')).toBe('10000');
  });

  describe('remove', () => {
    it('takes the product out of the hash and both sorted sets', async () => {
      await write.write(entry(), EARLY);

      expect(await write.remove(1, 'knitwear', LATER)).toBe(true);
      expect(await read.find(1)).toBeUndefined();
      expect(await redis().zscore(ProductReadRepository.ALL_PRODUCTS, '1')).toBeNull();
    });

    it('leaves a token behind, so a recompute in flight cannot resurrect it', async () => {
      await write.write(entry(), EARLY);
      await write.remove(1, 'knitwear', LATER);

      // The absent hash is not "never written": the token says otherwise.
      expect(await write.write(entry(), EARLY)).toBe(false);
      expect(await read.find(1)).toBeUndefined();
    });

    it('refuses a delete that read earlier than the last write', async () => {
      await write.write(entry(), LATER);

      expect(await write.remove(1, 'knitwear', EARLY)).toBe(false);
      expect(await read.find(1)).toBeDefined();
    });
  });

  it('omits the pricing rules version when the product has none', async () => {
    await write.write(entry({ pricingRulesVersion: 1_789_238_046 }), EARLY);
    await write.write(entry(), LATER);

    expect(await read.find(1)).not.toHaveProperty('pricingRulesVersion');
  });

  it('treats an absent token as never written, so the first write applies', async () => {
    expect(await redis().hget(ProductWriteRepository.TOKENS, '1')).toBeNull();

    expect(await write.write(entry(), EARLY)).toBe(true);
  });
});
