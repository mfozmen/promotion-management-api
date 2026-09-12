import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { pricingRules } from '../../src/shared/db/schema.js';
import { useTestDatabase } from './db.js';

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

  it('states every rule as json-rules-engine conditions and an event', async () => {
    const [markup] = await db()
      .select()
      .from(pricingRules)
      .where(eq(pricingRules.name, 'electronics category markup'));

    expect(markup?.conditions).toEqual({
      all: [{ fact: 'category', operator: 'equal', value: 'electronics' }],
    });
    expect(markup?.event).toEqual({
      type: 'adjustPrice',
      params: { operation: 'markup', basisPoints: 1500 },
    });
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
