import { describe, expect, it } from 'vitest';
import { compileRules } from '../../../../../src/modules/pricing/domain/compile-rules.js';
import { priceRow } from '../../../../../src/modules/pricing/domain/price-row.js';
import type { PricingRuleRow } from '../../../../../src/modules/pricing/domain/pricing-rule-row.js';
import type { VendorRowFacts } from '../../../../../src/modules/pricing/domain/vendor-row-facts.js';

const at = (iso: string) => new Date(iso);

const ruleRow = (
  over: Partial<PricingRuleRow> & Pick<PricingRuleRow, 'name' | 'conditions' | 'event'>,
): PricingRuleRow => ({
  id: 1,
  type: 'ingestion',
  priority: 0,
  active: true,
  updatedAt: at('2026-09-01T00:00:00.000Z'),
  ...over,
});

const categoryIs = (category: string) => ({
  all: [{ fact: 'category', operator: 'equal', value: category }],
});

const always = {
  all: [{ fact: 'vendorPriceCents', operator: 'greaterThanInclusive', value: 0 }],
};

const percent = (bps: number) => ({ type: 'adjustPercentBps', params: { value: bps } });

const vendorRow = (over: Partial<VendorRowFacts> = {}): VendorRowFacts => ({
  category: 'Electronics',
  vendorPriceCents: 80_000,
  stockQuantity: 150,
  ...over,
});

describe('compileRules', () => {
  it('ignores inactive rows and derives the version from the active rows', async () => {
    const compiled = await compileRules([
      ruleRow({
        id: 1,
        name: 'markup',
        conditions: categoryIs('Electronics'),
        event: percent(1500),
        updatedAt: at('2026-09-02T00:00:10.000Z'),
      }),
      ruleRow({
        id: 2,
        name: 'stale',
        conditions: always,
        event: percent(9999),
        active: false,
        updatedAt: at('2026-09-09T00:00:00.000Z'),
      }),
    ]);

    expect(compiled.pricingRulesVersion).toBe(Date.parse('2026-09-02T00:00:10.000Z'));
  });

  it('refuses an empty rule set rather than pricing a catalogue at vendor cost', async () => {
    await expect(compileRules([])).rejects.toThrowError(
      /no active ingestion pricing rules \(none seeded, or every rule deactivated\)/,
    );
  });

  it('refuses a rule set whose every row is inactive', async () => {
    await expect(
      compileRules([
        ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500), active: false }),
      ]),
    ).rejects.toThrowError(
      /no active ingestion pricing rules \(none seeded, or every rule deactivated\)/,
    );
  });

  it('names the rules it compiled, so a rule the caller expected cannot go missing quietly', async () => {
    const compiled = await compileRules([
      ruleRow({ id: 7, name: 'commission', priority: 10, conditions: always, event: percent(500) }),
      ruleRow({ id: 4, name: 'markup', priority: 30, conditions: always, event: percent(1500) }),
      ruleRow({ id: 9, name: 'retired', conditions: always, event: percent(100), active: false }),
    ]);

    // Evaluation order, so a log of these ids says what priced the file.
    expect(compiled.ruleIds).toEqual([4, 7]);
  });

  it('ignores a promotion-layer rule, which this engine cannot price', async () => {
    const compiled = await compileRules([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
      ruleRow({
        id: 2,
        type: 'promotion',
        name: 'largest discount wins',
        conditions: always,
        event: { type: 'selectCandidate', params: { level: 'product' } },
      }),
    ]);

    await expect(priceRow(compiled, vendorRow())).resolves.toMatchObject({
      basePriceCents: 92_000,
    });
  });

  it('rejects with a descriptive error for an unknown event type', async () => {
    await expect(
      compileRules([
        ruleRow({
          id: 7,
          name: 'broken',
          conditions: always,
          event: { type: 'adjustDollars', params: { value: 1 } },
        }),
      ]),
    ).rejects.toThrowError(/pricing rule 7 \("broken"\)/);
  });

  it('rejects with a descriptive error for a non-integer adjustment value', async () => {
    await expect(
      compileRules([
        ruleRow({ id: 8, name: 'fractional', conditions: always, event: percent(1.5) }),
      ]),
    ).rejects.toThrowError(/pricing rule 8 \("fractional"\)/);
  });

  it('rejects a percentage adjustment that removes more than the whole price', async () => {
    await expect(
      compileRules([
        ruleRow({
          id: 13,
          name: 'over-100-percent-off',
          conditions: always,
          event: percent(-10_001),
        }),
      ]),
    ).rejects.toThrowError(/pricing rule 13 \("over-100-percent-off"\)/);
  });

  it('accepts a percentage adjustment that removes exactly the whole price', async () => {
    const rules = await compileRules([
      ruleRow({ id: 14, name: 'free', conditions: always, event: percent(-10_000) }),
    ]);

    await expect(priceRow(rules, vendorRow())).resolves.toMatchObject({ basePriceCents: 0 });
  });

  it('rejects with a descriptive error for a rule naming a fact no vendor row has', async () => {
    await expect(
      compileRules([
        ruleRow({
          id: 10,
          name: 'vendor-tier',
          conditions: { all: [{ fact: 'vendorTier', operator: 'equal', value: 'gold' }] },
          event: percent(100),
        }),
      ]),
    ).rejects.toThrowError(/pricing rule 10 \("vendor-tier"\) cannot be compiled.*vendorTier/);
  });

  it('rejects with a descriptive error for an unknown operator', async () => {
    await expect(
      compileRules([
        ruleRow({
          id: 11,
          name: 'typo',
          conditions: { all: [{ fact: 'stockQuantity', operator: 'greaterThn', value: 100 }] },
          event: percent(100),
        }),
      ]),
    ).rejects.toThrowError(/pricing rule 11 \("typo"\) cannot be compiled/);
  });

  it('rejects a typo that hides behind a higher-priority condition', async () => {
    await expect(
      compileRules([
        ruleRow({
          id: 12,
          name: 'hidden-typo',
          conditions: {
            all: [
              { fact: 'category', operator: 'equal', value: 'Shoes', priority: 10 },
              { fact: 'stockQuantity', operator: 'greaterThn', value: 100, priority: 1 },
            ],
          },
          event: percent(100),
        }),
      ]),
    ).rejects.toThrowError(/pricing rule 12 \("hidden-typo"\) cannot be compiled/);
  });

  it('rejects with a descriptive error for malformed conditions', async () => {
    await expect(
      compileRules([
        ruleRow({ id: 9, name: 'no-conditions', conditions: { nope: [] }, event: percent(100) }),
      ]),
    ).rejects.toThrowError(/pricing rule 9 \("no-conditions"\)/);
  });
});
