import { describe, expect, it } from 'vitest';
import { ProductSourceRepository } from '@src/modules/storefront/db/product-source-repository.js';
import { products } from '@src/modules/product/db/schema/products.js';
import { promotions } from '@src/modules/promotion/db/schema/promotions.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

/** `id` is `generated always`, so the database chooses it and the test reads it
 *  back rather than inventing one. */
async function insert(
  rows: { sku: string; pricingRulesVersion?: number }[],
  // A category of its own per test: the exclusion constraints are all-time, so
  // one test's category promotion would refuse the next test's insert.
  category = 'knitwear',
): Promise<number[]> {
  const inserted = await db()
    .insert(products)
    .values(
      rows.map(({ sku, pricingRulesVersion }) => ({
        sku,
        name: `Product ${sku}`,
        category,
        basePriceCents: 10_000,
        stockQuantity: 5,
        ...(pricingRulesVersion === undefined ? {} : { pricingRulesVersion }),
      })),
    )
    .returning({ id: products.id });

  return inserted.map(({ id }) => id);
}

/** A running promotion, unless the caller moves the window or the status. */
async function promote(
  target: { productId: number } | { category: string },
  over: Partial<typeof promotions.$inferInsert> = {},
): Promise<number> {
  const [inserted] = await db()
    .insert(promotions)
    .values({
      name: 'Winter sale',
      discountType: 'percentage',
      value: 2_000,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3_600_000),
      status: 'active',
      ...target,
      ...over,
    })
    .returning({ id: promotions.id });

  return inserted!.id;
}

describe('ProductSourceRepository', () => {
  it('carries the product own promotion as a candidate', async () => {
    const [one] = await insert([{ sku: 'SKU-J' }]);
    const promotionId = await promote({ productId: one! });

    const { rows } = await new ProductSourceRepository(db()).read([one!]);

    expect(rows[0]?.productPromotion).toEqual({
      id: promotionId,
      name: 'Winter sale',
      discountType: 'percentage',
      value: 2_000,
    });
    expect(rows[0]?.categoryPromotion).toBeNull();
  });

  it('carries the category promotion as the other candidate', async () => {
    const [one] = await insert([{ sku: 'SKU-K' }], 'coats');
    const promotionId = await promote({ category: 'coats' });

    const { rows } = await new ProductSourceRepository(db()).read([one!]);

    expect(rows[0]?.categoryPromotion).toMatchObject({ id: promotionId, value: 2_000 });
    expect(rows[0]?.productPromotion).toBeNull();
  });

  it('carries both when both are running, because the resolver chooses between them', async () => {
    const [one] = await insert([{ sku: 'SKU-L' }], 'scarves');
    await promote({ productId: one! }, { name: 'Its own' });
    await promote({ category: 'scarves' }, { name: 'The sale' });

    const { rows } = await new ProductSourceRepository(db()).read([one!]);

    expect(rows[0]?.productPromotion?.name).toBe('Its own');
    expect(rows[0]?.categoryPromotion?.name).toBe('The sale');
  });

  it('leaves out a promotion that is not running, on the database clock alone', async () => {
    const [one] = await insert([{ sku: 'SKU-M' }], 'hats');
    await promote({ productId: one! }, { status: 'cancelled' });
    await promote(
      { category: 'hats' },
      {
        startsAt: new Date(Date.now() + 3_600_000),
        endsAt: new Date(Date.now() + 7_200_000),
      },
    );

    const { rows } = await new ProductSourceRepository(db()).read([one!]);

    // A second opinion about the window in TypeScript is what publishes a
    // discount for a promotion SQL considers expired.
    expect(rows[0]?.productPromotion).toBeNull();
    expect(rows[0]?.categoryPromotion).toBeNull();
  });

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

  it('pages a category by the last id it saw, in the order the index holds', async () => {
    const ids = await insert([{ sku: 'SKU-N1' }, { sku: 'SKU-N2' }, { sku: 'SKU-N3' }], 'jumpers');
    await insert([{ sku: 'SKU-N4' }], 'socks');
    const source = new ProductSourceRepository(db());

    await expect(source.idsInCategory('jumpers', 0)).resolves.toEqual(ids);
    await expect(source.idsInCategory('jumpers', ids[1]!)).resolves.toEqual([ids[2]]);
    await expect(source.idsInCategory('jumpers', ids[2]!)).resolves.toEqual([]);
  });

  it('reads the instant from the database clock, as epoch microseconds', async () => {
    const [one] = await insert([{ sku: 'SKU-F' }]);

    const before = Date.now();
    const { sourceReadAt } = await new ProductSourceRepository(db()).read([one!]);

    // Digits only, so the Lua compare is a number's and no rendering of a
    // timestamp can sort above another (ADR-0003).
    expect(sourceReadAt).toMatch(/^\d+$/);
    expect(Number(sourceReadAt) / 1000).toBeGreaterThan(before - 60_000);
  });

  it('renders the empty batch with the same clock rather than a worker own clock', async () => {
    const [one] = await insert([{ sku: 'SKU-I' }]);

    const matched = await new ProductSourceRepository(db()).read([one!]);
    const { rows, sourceReadAt } = await new ProductSourceRepository(db()).read([404_404]);

    // An empty batch still orders its removals, and an instant of another shape
    // would outrank every token PostgreSQL ever wrote.
    expect(rows).toEqual([]);
    expect(sourceReadAt).toMatch(/^\d+$/);
    expect(Number(sourceReadAt)).toBeGreaterThan(Number(matched.sourceReadAt));
  });

  it('counts every category in one statement, which is what the drift check compares', async () => {
    // One row per category rather than a count per category: the reconciler asks
    // this on every run, and a query per category would scale with the catalogue.
    await insert([{ sku: 'SKU-CC1' }, { sku: 'SKU-CC2' }], 'drift-one');
    await insert([{ sku: 'SKU-CC3' }], 'drift-two');

    const counts = await new ProductSourceRepository(db()).categoryCounts();

    expect(counts.get('drift-one')).toBe(2);
    expect(counts.get('drift-two')).toBe(1);
    expect(counts.get('no-such-category')).toBeUndefined();
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
