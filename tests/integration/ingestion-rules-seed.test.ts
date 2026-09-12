import { and, asc, desc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  compileRules,
  createRuleSetLoader,
  priceRow,
  type PricingRuleRow,
} from '../../src/modules/pricing/ingestion-rules.js';
import { pricingRules } from '../../src/shared/db/schema.js';
import { useTestDatabase } from './db.js';

const db = useTestDatabase();

/** The loader the chunk processor (#16) will hold: one query, newest priority
 *  first, ingestion rules only. Written here because the seeded rows are the
 *  only thing that proves the wrapper and the migration speak one language.
 *  Both predicates are needed to reach `pricing_rules_active_idx`, which is
 *  partial on `active`; `type` alone plans as a sequential scan. */
const loadSeededRules = (): Promise<PricingRuleRow[]> =>
  db()
    .select()
    .from(pricingRules)
    .where(and(eq(pricingRules.type, 'ingestion'), eq(pricingRules.active, true)))
    .orderBy(desc(pricingRules.priority), asc(pricingRules.id));

const vendorRow = (over: Partial<Record<string, unknown>> = {}) => ({
  category: 'Electronics',
  vendorPriceCents: 80_000,
  stockQuantity: 150,
  ...over,
});

describe('the seeded rules through the engine wrapper', () => {
  it('compiles every seeded ingestion rule', async () => {
    const compiled = await compileRules(await loadSeededRules());
    const seeded = await loadSeededRules();

    expect(compiled.ruleIds).toEqual(seeded.map((rule) => rule.id));
  });

  it('prices the case-study row the way issue #9 says it should', async () => {
    const compiled = await compileRules(await loadSeededRules());

    // 80000 +15 % markup = 92000, -3 % bulk stock = 89240, +5 % commission = 93702.
    await expect(priceRow(compiled, vendorRow())).resolves.toMatchObject({
      ok: true,
      basePriceCents: 93_702,
    });
  });

  it('leaves a row that matches only the commission at the commission', async () => {
    const compiled = await compileRules(await loadSeededRules());

    await expect(
      priceRow(compiled, vendorRow({ category: 'Apparel', stockQuantity: 10 })),
    ).resolves.toMatchObject({ ok: true, basePriceCents: 84_000 });
  });

  it('stamps the row with the version the seeded rules carry', async () => {
    const compiled = await compileRules(await loadSeededRules());
    const seeded = await loadSeededRules();
    const newest = Math.max(...seeded.map((rule) => rule.updatedAt.getTime()));

    expect(compiled.pricingRulesVersion).toBe(Math.floor(newest / 1000));
  });

  it('prices through the cached loader, the way a batch will', async () => {
    const loader = createRuleSetLoader({ load: loadSeededRules, now: () => 0 });

    const [first, second] = await Promise.all([loader(), loader()]);

    expect(second).toBe(first);
    await expect(priceRow(first, vendorRow())).resolves.toMatchObject({
      basePriceCents: 93_702,
    });
  });

  it('refuses to price anything once the rules are deactivated', async () => {
    const setActive = (active: boolean) =>
      db().update(pricingRules).set({ active }).where(eq(pricingRules.type, 'ingestion'));

    await setActive(false);
    try {
      // The catalogue would otherwise be stored at raw vendor cost with the
      // job reporting success, so the whole run stops here instead.
      await expect(compileRules(await loadSeededRules())).rejects.toThrowError(
        /no active ingestion pricing rules/,
      );
    } finally {
      // Restored, so the file does not depend on this being its last test.
      await setActive(true);
    }
  });
});
