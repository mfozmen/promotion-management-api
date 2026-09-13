import { describe, expect, it } from 'vitest';
import { ProductSourceRepository } from '@src/modules/storefront/db/product-source-repository.js';
import { products } from '@src/modules/product/db/schema/products.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

/** `id` is `generated always`, so the database chooses it and the test reads it
 *  back rather than inventing one. */
async function insert(rows: { sku: string; pricingRulesVersion?: number }[]): Promise<number[]> {
  const inserted = await db()
    .insert(products)
    .values(
      rows.map(({ sku, pricingRulesVersion }) => ({
        sku,
        name: `Product ${sku}`,
        category: 'knitwear',
        basePriceCents: 10_000,
        stockQuantity: 5,
        ...(pricingRulesVersion === undefined ? {} : { pricingRulesVersion }),
      })),
    )
    .returning({ id: products.id });

  return inserted.map(({ id }) => id);
}

describe('ProductSourceRepository', () => {
  it('reads the rows a recompute works from', async () => {
    const [one, two] = await insert([{ sku: 'SKU-A' }, { sku: 'SKU-B' }]);

    const { rows } = await new ProductSourceRepository(db()).read([one!, two!]);

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === one)).toMatchObject({
      sku: 'SKU-A',
      basePriceCents: 10_000,
      stockQuantity: 5,
    });
  });

  it('returns only the ids it was asked for', async () => {
    const [one] = await insert([{ sku: 'SKU-C' }, { sku: 'SKU-D' }]);

    const { rows } = await new ProductSourceRepository(db()).read([one!]);

    expect(rows.map((r) => r.id)).toEqual([one]);
  });

  it('omits an id PostgreSQL no longer holds, so the caller can remove it', async () => {
    const [one] = await insert([{ sku: 'SKU-E' }]);

    const { rows } = await new ProductSourceRepository(db()).read([one!, 999_999]);

    expect(rows.map((r) => r.id)).toEqual([one]);
  });

  it('reads the instant from the database clock, in the same statement', async () => {
    const [one] = await insert([{ sku: 'SKU-F' }]);

    const before = Date.now();
    const { sourceReadAt } = await new ProductSourceRepository(db()).read([one!]);

    // A worker's own clock would not order two workers' writes; this one is
    // PostgreSQL's, and it parses as a timestamp rather than being any string.
    expect(Number.isNaN(Date.parse(sourceReadAt))).toBe(false);
    expect(Date.parse(sourceReadAt)).toBeGreaterThan(before - 60_000);
  });

  it('still answers with an instant when the batch matched nothing', async () => {
    const { rows, sourceReadAt } = await new ProductSourceRepository(db()).read([404_404]);

    // An empty batch still orders its removals, and a second statement to
    // fetch the instant would be a second instant.
    expect(rows).toEqual([]);
    expect(Number.isNaN(Date.parse(sourceReadAt))).toBe(false);
  });

  it('carries the pricing rules version when the row has one, and null when not', async () => {
    const [withVersion, without] = await insert([
      { sku: 'SKU-G', pricingRulesVersion: 1_789_238_046 },
      { sku: 'SKU-H' },
    ]);

    const { rows } = await new ProductSourceRepository(db()).read([withVersion!, without!]);

    expect(rows.find((r) => r.id === withVersion)?.pricingRulesVersion).toBe(1_789_238_046);
    expect(rows.find((r) => r.id === without)?.pricingRulesVersion).toBeNull();
  });
});
