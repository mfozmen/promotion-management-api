import { asc, desc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { pricingRules } from '@src/modules/pricing/db/schema/pricing-rules.js';
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

  it('carries no promotion-typed rules yet, because the resolver rules are #36', async () => {
    const rows = await db().select().from(pricingRules).where(eq(pricingRules.type, 'promotion'));

    expect(rows).toEqual([]);
  });
});
