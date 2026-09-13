import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { products } from '@src/modules/product/db/schema/products.js';
import { ProductRepository } from '@src/modules/product/db/product-repository.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

let sequence = 0;

/** A distinct SKU per call, so files sharing one database clone do not collide. */
const sku = () => `SKU-${(sequence += 1)}`;

const product = (
  overrides: Partial<Parameters<ProductRepository['upsertMany']>[1][number]> = {},
) => ({
  sku: sku(),
  name: 'a name',
  category: 'shoes',
  basePriceCents: 1000,
  stockQuantity: 5,
  pricingRulesVersion: 7,
  ingestJobId: 1,
  ingestSourceOffset: 100,
  ...overrides,
});

const rowFor = async (value: string) => {
  const [row] = await db().select().from(products).where(eq(products.sku, value));
  return row;
};

describe('ProductRepository.upsertMany', () => {
  it('inserts new products and returns their ids in the order given', async () => {
    const batch = [product(), product(), product()];

    const ids = await new ProductRepository(db()).upsertMany(db(), batch);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    for (const [index, id] of ids.entries()) {
      expect((await rowFor(batch[index]!.sku))?.id).toBe(id);
    }
  });

  it('stores the provenance the announcement and a resume both depend on', async () => {
    const batch = [product({ ingestJobId: 42, ingestSourceOffset: 4096, pricingRulesVersion: 3 })];

    await new ProductRepository(db()).upsertMany(db(), batch);

    const row = await rowFor(batch[0]!.sku);
    expect(row?.ingestJobId).toBe(42);
    expect(row?.ingestSourceOffset).toBe(4096);
    expect(row?.pricingRulesVersion).toBe(3);
  });

  it('updates a product already stored under that sku rather than failing on the unique', async () => {
    const existing = product({ name: 'old', basePriceCents: 1000, stockQuantity: 5 });
    await new ProductRepository(db()).upsertMany(db(), [existing]);

    // A later row from the same file, so the provenance guard admits it.
    const ids = await new ProductRepository(db()).upsertMany(db(), [
      { ...existing, name: 'new', basePriceCents: 2500, stockQuantity: 0, ingestSourceOffset: 999 },
    ]);

    const row = await rowFor(existing.sku);
    expect(ids).toEqual([row?.id]);
    expect(row?.name).toBe('new');
    expect(row?.basePriceCents).toBe(2500);
    expect(row?.stockQuantity).toBe(0);
  });

  it('keeps one row per sku across a re-import, so a replay does not duplicate the catalogue', async () => {
    const batch = [product(), product()];
    await new ProductRepository(db()).upsertMany(db(), batch);

    const second = await new ProductRepository(db()).upsertMany(db(), batch);

    const first = await db().select().from(products).where(eq(products.sku, batch[0]!.sku));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
  });

  it('moves updated_at forward on an update, so a re-import is visible as one', async () => {
    const existing = product();
    await new ProductRepository(db()).upsertMany(db(), [existing]);
    const before = (await rowFor(existing.sku))?.updatedAt;

    await new ProductRepository(db()).upsertMany(db(), [
      { ...existing, stockQuantity: 99, ingestSourceOffset: 999 },
    ]);

    expect((await rowFor(existing.sku))?.updatedAt?.getTime()).toBeGreaterThan(
      before?.getTime() ?? 0,
    );
  });

  it('takes the last of a sku repeated inside one batch', async () => {
    // PostgreSQL refuses to let one ON CONFLICT statement touch a row twice
    // ("cannot affect row a second time"), and a vendor file repeating a SKU in
    // one batch is a vendor's mistake, not a reason to fail 499 good rows.
    const repeated = sku();

    const ids = await new ProductRepository(db()).upsertMany(db(), [
      product({ sku: repeated, stockQuantity: 1 }),
      product({ sku: repeated, stockQuantity: 2 }),
    ]);

    expect(ids).toHaveLength(1);
    expect((await rowFor(repeated))?.stockQuantity).toBe(2);
  });

  it('keeps the later row when an earlier chunk arrives after a later one', async () => {
    // Resolution is by where the row came from, not by which write committed
    // last: chunks are claimed independently and six were in flight at once on a
    // real 500 000-row run, so the order rows are written is not the order of
    // their offsets. The design spec says "not commit order" in those words.
    const existing = product({ ingestJobId: 5, ingestSourceOffset: 900, name: 'later' });
    await new ProductRepository(db()).upsertMany(db(), [existing]);

    await new ProductRepository(db()).upsertMany(db(), [
      { ...existing, ingestJobId: 5, ingestSourceOffset: 100, name: 'earlier' },
    ]);

    expect((await rowFor(existing.sku))?.name).toBe('later');
  });

  it('takes a row from a later job over one from an earlier job', async () => {
    const existing = product({ ingestJobId: 5, ingestSourceOffset: 900, name: 'old import' });
    await new ProductRepository(db()).upsertMany(db(), [existing]);

    await new ProductRepository(db()).upsertMany(db(), [
      { ...existing, ingestJobId: 6, ingestSourceOffset: 1, name: 'new import' },
    ]);

    expect((await rowFor(existing.sku))?.name).toBe('new import');
  });

  it('overwrites a product that has no provenance, rather than skipping it', async () => {
    // A product created through the API has both columns null, and a row-value
    // comparison against NULL is NULL rather than true — so a guard that did not
    // name the null branch would silently never update a manually created
    // product from a vendor file (REVIEW.md 2.6). The two columns are written
    // together and the schema checks it, so one null branch covers both.
    const [manual] = await db()
      .insert(products)
      .values({
        sku: sku(),
        name: 'created by hand',
        category: 'shoes',
        basePriceCents: 500,
        stockQuantity: 1,
      })
      .returning();

    await new ProductRepository(db()).upsertMany(db(), [
      product({ sku: manual!.sku, name: 'from the vendor', ingestJobId: 1, ingestSourceOffset: 0 }),
    ]);

    expect((await rowFor(manual!.sku))?.name).toBe('from the vendor');
  });

  it('returns an id for every row it was given, including one it did not write', async () => {
    // The caller announces what it hands back, and a skipped row is still a
    // product the read model may not have seen. Returning fewer ids than rows
    // would put `undefined` in the announcement, which the event schema rejects
    // after the batch has already committed.
    const existing = product({ ingestJobId: 9, ingestSourceOffset: 900 });
    await new ProductRepository(db()).upsertMany(db(), [existing]);

    const ids = await new ProductRepository(db()).upsertMany(db(), [
      { ...existing, ingestSourceOffset: 1 },
    ]);

    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe((await rowFor(existing.sku))?.id);
  });

  it('writes nothing and returns nothing for an empty batch', async () => {
    expect(await new ProductRepository(db()).upsertMany(db(), [])).toEqual([]);
  });
});
