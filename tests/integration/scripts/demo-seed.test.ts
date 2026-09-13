import { readFile } from 'node:fs/promises';
import { count, eq, like, max } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { products } from '@src/modules/catalog/db/schema/products.js';
import { activePromotions } from '@src/modules/promotion/db/schema/active-promotions.js';
import { promotions } from '@src/modules/promotion/db/schema/promotions.js';
import { useTestDatabase } from '../db.js';

const db = useTestDatabase();

let statements: string;

beforeAll(async () => {
  statements = await readFile(new URL('../../../scripts/demo-seed.sql', import.meta.url), 'utf8');
});

// Through the pool rather than drizzle's `execute`: node-postgres sends a parameterised query
// over the extended protocol, which refuses more than one statement per message. This is also
// the call `scripts/seed.ts` makes, so the implicit transaction around the file is the same one.
const seed = (): Promise<unknown> => db().$client.query(statements);

describe('demo seed', () => {
  it('fills the catalogue and opens the flash sale', async () => {
    await seed();

    const [catalogue] = await db()
      .select({ products: count() })
      .from(products)
      .where(like(products.sku, 'DEMO-%'));
    expect(catalogue).toEqual({ products: 1000 });

    const sale = await db()
      .select({
        name: activePromotions.name,
        discountType: activePromotions.discountType,
        value: activePromotions.value,
        category: activePromotions.category,
      })
      .from(activePromotions);
    expect(sale).toEqual([
      {
        name: 'Demo electronics flash sale',
        discountType: 'percentage',
        value: 2000,
        category: 'Electronics',
      },
    ]);
  });

  it('leaves the same rows when a reviewer runs it twice', async () => {
    await seed();
    const columns = {
      products: count(),
      lastId: max(products.id),
      touched: max(products.updatedAt),
    };
    const [firstRun] = await db().select(columns).from(products);

    await seed();

    const [afterwards] = await db().select(columns).from(products);
    // The same rows, not the same shape: a seed that deleted the catalogue and rebuilt it would
    // also survive two runs, but with a fresh identity and a moved `updated_at`. Unmoved also
    // means no row was rewritten, so the second run leaves autovacuum nothing (REVIEW.md 6.17).
    expect(afterwards).toEqual(firstRun);
    expect(afterwards?.products).toBe(1000);

    const [sales] = await db()
      .select({ rows: count() })
      .from(promotions)
      .where(eq(promotions.name, 'Demo electronics flash sale'));
    expect(sales).toEqual({ rows: 1 });
  });

  it('takes back a row an import had claimed', async () => {
    await seed();
    await db()
      .update(products)
      .set({ basePriceCents: 79_990, ingestJobId: 42, ingestSourceOffset: 512 })
      .where(eq(products.sku, 'DEMO-0004'));

    await seed();

    const [reclaimed] = await db()
      .select({
        basePriceCents: products.basePriceCents,
        ingestJobId: products.ingestJobId,
        ingestSourceOffset: products.ingestSourceOffset,
      })
      .from(products)
      .where(eq(products.sku, 'DEMO-0004'));
    // The provenance goes with the price. Leaving it would have the row name an ingestion job
    // whose values are gone, and #16's offset guard would then decline to re-apply them.
    expect(reclaimed).toEqual({
      basePriceCents: 1200,
      ingestJobId: null,
      ingestSourceOffset: null,
    });
  });
});
