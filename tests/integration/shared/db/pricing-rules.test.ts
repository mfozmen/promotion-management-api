import { asc, desc, eq } from 'drizzle-orm';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { pricingRules } from '@src/modules/pricing/db/schema/pricing-rules.js';
import { PromotionResolver } from '@src/modules/promotion/domain/promotion-resolver.js';
import { useTestDatabase } from '../../db.js';

const db = useTestDatabase();

describe('seeded pricing rules', () => {
  it('holds the three case-study ingestion rules, ordered by priority', async () => {
    const rows = await db()
      .select()
      .from(pricingRules)
      .where(eq(pricingRules.type, 'ingestion'))
      .orderBy(asc(pricingRules.priority));

    expect(rows.map((row) => row.name)).toEqual([
      'vendor commission',
      'bulk stock discount',
      'electronics category markup',
    ]);
    expect(rows.every((row) => row.active)).toBe(true);
  });

  // Applied in priority order to an Electronics row at 80 000 cents with stock 150 that is
  // 80 000 → 92 000 → 89 240 → 93 702; an Apparel row at 80 000 with stock 10 is 84 000.
  it('states every rule in the vocabulary the ingestion wrapper compiles', async () => {
    const rows = await db()
      .select()
      .from(pricingRules)
      .where(eq(pricingRules.type, 'ingestion'))
      .orderBy(desc(pricingRules.priority));

    expect(
      rows.map((row) => ({ name: row.name, conditions: row.conditions, event: row.event })),
    ).toEqual([
      {
        name: 'electronics category markup',
        conditions: { all: [{ fact: 'category', operator: 'equal', value: 'Electronics' }] },
        event: { type: 'adjustPercentBps', params: { value: 1500 } },
      },
      {
        name: 'bulk stock discount',
        conditions: { all: [{ fact: 'stockQuantity', operator: 'greaterThan', value: 100 }] },
        event: { type: 'adjustPercentBps', params: { value: -300 } },
      },
      {
        name: 'vendor commission',
        conditions: {
          all: [{ fact: 'vendorPriceCents', operator: 'greaterThanInclusive', value: 0 }],
        },
        event: { type: 'adjustPercentBps', params: { value: 500 } },
      },
    ]);
  });

  it('cannot hold the same rule twice, so a re-applied seed never doubles a markup', async () => {
    const duplicate = db().insert(pricingRules).values({
      name: 'electronics category markup',
      type: 'ingestion',
      conditions: {},
      event: {},
    });

    await expect(duplicate).rejects.toThrow();
  });

  it('stamps updated_at on an edit, because the writer is a person at a psql prompt', async () => {
    const [edited] = await db()
      .update(pricingRules)
      .set({ priority: 10 }) // the value it already holds, so no other test's premise moves
      .where(eq(pricingRules.name, 'vendor commission'))
      .returning({ createdAt: pricingRules.createdAt, updatedAt: pricingRules.updatedAt });

    expect(edited!.updatedAt.getTime()).toBeGreaterThan(edited!.createdAt.getTime());
  });

  it('seeds a promotion policy of four rules at distinct priorities', async () => {
    const rows = await db()
      .select()
      .from(pricingRules)
      .where(eq(pricingRules.type, 'promotion'))
      .orderBy(desc(pricingRules.priority));

    // The one place a seeded rule is asserted: this is a migration row, so it
    // changes by commit and the assertion changes with it. Every other test
    // inserts the rule it argues about. Four because an event names one
    // outcome, and two candidates and one candidate are four outcomes.
    expect(rows.map((row) => [row.name, row.priority])).toEqual([
      ['product-only', 30],
      ['category-only', 25],
      ['lower-price-product', 20],
      ['lower-price-category', 15],
    ]);
    expect(new Set(rows.map((row) => row.priority)).size).toBe(rows.length);
    expect(rows.every((row) => row.active)).toBe(true);
  });

  it('prices the seeded policy the way the shopper is promised, through the resolver itself', async () => {
    const rows = await db().select().from(pricingRules);
    const resolver = await PromotionResolver.fromRules(rows, pino({ level: 'silent' }));
    const facts = (productPriceCents: number | null, categoryPriceCents: number | null) => ({
      category: 'knitwear',
      stockQuantity: 5,
      basePriceCents: 10_000,
      productPriceCents,
      categoryPriceCents,
    });

    // A 5 % product promotion inside a 50 % category sale takes the sale price.
    await expect(resolver.select(facts(9_500, 5_000))).resolves.toBe('category');
    await expect(resolver.select(facts(5_000, 9_500))).resolves.toBe('product');
    await expect(resolver.select(facts(5_000, 5_000))).resolves.toBe('product');
    // And the arity-one pair, which is what keeps a later exclusion rule reachable.
    await expect(resolver.select(facts(9_500, null))).resolves.toBe('product');
    await expect(resolver.select(facts(null, 5_000))).resolves.toBe('category');
    await expect(resolver.select(facts(null, null))).resolves.toBeUndefined();
  });
});
