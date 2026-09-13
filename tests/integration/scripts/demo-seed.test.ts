import { readFile } from 'node:fs/promises';
import { asc, count, eq, inArray, like, max } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { products } from '@src/modules/catalog/db/schema/products.js';
import { activePromotions } from '@src/modules/promotion/db/schema/active-promotions.js';
import { promotions } from '@src/modules/promotion/db/schema/promotions.js';
import { sqlStateOf, useTestDatabase } from '../db.js';

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
      .set({
        basePriceCents: 79_990,
        ingestJobId: 42,
        ingestSourceOffset: 512,
        pricingRulesVersion: 1_789_234_960_908,
      })
      .where(eq(products.sku, 'DEMO-0004'));

    await seed();

    const [reclaimed] = await db()
      .select({
        basePriceCents: products.basePriceCents,
        ingestJobId: products.ingestJobId,
        ingestSourceOffset: products.ingestSourceOffset,
        pricingRulesVersion: products.pricingRulesVersion,
      })
      .from(products)
      .where(eq(products.sku, 'DEMO-0004'));
    expect(reclaimed).toEqual({
      basePriceCents: 1200,
      ingestJobId: null,
      ingestSourceOffset: null,
      pricingRulesVersion: null,
    });
  });

  it('leaves one whole catalogue when two seeds race', async () => {
    // Raced twice because the upsert takes two different paths and only one of them is reached
    // on a database that already holds the rows: an empty catalogue races speculative insertion,
    // a full one races the no-op update. On READ COMMITTED, the pool's only level.
    await db().$client.query(`delete from products where sku like 'DEMO-%'`);
    expect(await Promise.all([seed(), seed()].map(sqlStateOf))).toEqual([undefined, undefined]);
    expect(await Promise.all([seed(), seed()].map(sqlStateOf))).toEqual([undefined, undefined]);

    const [catalogue] = await db()
      .select({ products: count() })
      .from(products)
      .where(like(products.sku, 'DEMO-%'));
    const [sales] = await db()
      .select({ rows: count() })
      .from(promotions)
      .where(eq(promotions.name, 'Demo electronics flash sale'));
    expect({ catalogue, sales }).toEqual({ catalogue: { products: 1000 }, sales: { rows: 1 } });
  });

  it('refuses to replace a promotion it does not own, and writes nothing', async () => {
    // Owns its data rather than inheriting it: whichever tests ran first, this one starts from
    // an empty catalogue and one promotion the seed did not write, and leaves neither behind.
    await db().$client.query('delete from promotions');
    await db().$client.query(`delete from products where sku like 'DEMO-%'`);
    await db().$client.query(
      `insert into promotions (name, discount_type, value, starts_at, ends_at, category, status)
       values ('Operator winter sale', 'percentage', 1000, now(), now() + interval '7 days', 'Electronics', 'active')`,
    );

    try {
      expect(await sqlStateOf(seed())).toBe('23P01');

      // One implicit transaction, so the products the seed had already written go back with the
      // promotion it could not insert. A half-filled catalogue would be the worse outcome: the
      // next run converges on it and reports success.
      const [catalogue] = await db()
        .select({ products: count() })
        .from(products)
        .where(like(products.sku, 'DEMO-%'));
      expect(catalogue).toEqual({ products: 0 });
    } finally {
      await db().$client.query(`delete from promotions where name = 'Operator winter sale'`);
    }
  });

  // Two files carry the same four rows and nothing else keeps them equal, so editing the seed's
  // categories would quietly turn the sample's updates into inserts.
  it('agrees with the vendor sample on the rows they share', async () => {
    await seed();
    const sample = await readFile(
      new URL('../../../fixtures/vendor-sample.csv', import.meta.url),
      'utf8',
    );
    const shared = sample
      .split(/\r?\n/)
      .filter((line) => line.startsWith('DEMO-'))
      .map((line) => line.split(','))
      .map(([sku, name, category]) => ({ sku, name, category }));
    expect(shared).toHaveLength(4);

    const seeded = await db()
      .select({ sku: products.sku, name: products.name, category: products.category })
      .from(products)
      .where(
        inArray(
          products.sku,
          shared.map(({ sku }) => sku ?? ''),
        ),
      )
      .orderBy(asc(products.sku));

    expect(seeded).toEqual([...shared].sort((a, b) => (a.sku ?? '').localeCompare(b.sku ?? '')));
  });
});
