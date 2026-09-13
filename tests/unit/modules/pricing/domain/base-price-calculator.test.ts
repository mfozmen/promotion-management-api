import { Engine } from 'json-rules-engine';
import { describe, expect, it } from 'vitest';
import type { PricingRuleRow } from '@src/modules/pricing/domain/dto/pricing-rule-row.js';
import type { VendorRowFacts } from '@src/modules/pricing/domain/dto/vendor-row-facts.js';
import { BasePriceCalculator } from '@src/modules/pricing/domain/base-price-calculator.js';

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

const stockAbove = (n: number) => ({
  all: [{ fact: 'stockQuantity', operator: 'greaterThan', value: n }],
});

const cents = (value: number) => ({ type: 'adjustCents', params: { value } });

describe('BasePriceCalculator', () => {
  it('ignores inactive rows and derives the version from the active rows', async () => {
    const compiled = await BasePriceCalculator.fromRules([
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
    await expect(BasePriceCalculator.fromRules([])).rejects.toThrowError(
      /no active ingestion pricing rules \(none seeded, or every rule deactivated\)/,
    );
  });

  it('refuses a rule set whose every row is inactive', async () => {
    await expect(
      BasePriceCalculator.fromRules([
        ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500), active: false }),
      ]),
    ).rejects.toThrowError(
      /no active ingestion pricing rules \(none seeded, or every rule deactivated\)/,
    );
  });

  it('names the rules it compiled, so a rule the caller expected cannot go missing quietly', async () => {
    const compiled = await BasePriceCalculator.fromRules([
      ruleRow({ id: 7, name: 'commission', priority: 10, conditions: always, event: percent(500) }),
      ruleRow({ id: 4, name: 'markup', priority: 30, conditions: always, event: percent(1500) }),
      ruleRow({ id: 9, name: 'retired', conditions: always, event: percent(100), active: false }),
    ]);

    expect(compiled.ruleIds).toEqual([4, 7]);
  });

  it('ignores a promotion-layer rule, which this engine cannot price', async () => {
    const compiled = await BasePriceCalculator.fromRules([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
      ruleRow({
        id: 2,
        type: 'promotion',
        name: 'largest discount wins',
        conditions: always,
        event: { type: 'selectCandidate', params: { level: 'product' } },
      }),
    ]);

    await expect(compiled.calculate(vendorRow())).resolves.toMatchObject({
      basePriceCents: 92_000,
    });
  });

  it('rejects with a descriptive error for an unknown event type', async () => {
    await expect(
      BasePriceCalculator.fromRules([
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
      BasePriceCalculator.fromRules([
        ruleRow({ id: 8, name: 'fractional', conditions: always, event: percent(1.5) }),
      ]),
    ).rejects.toThrowError(/pricing rule 8 \("fractional"\)/);
  });

  it('rejects a percentage adjustment that removes more than the whole price', async () => {
    await expect(
      BasePriceCalculator.fromRules([
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
    const rules = await BasePriceCalculator.fromRules([
      ruleRow({ id: 14, name: 'free', conditions: always, event: percent(-10_000) }),
    ]);

    await expect(rules.calculate(vendorRow())).resolves.toMatchObject({
      basePriceCents: 0,
    });
  });

  it('rejects with a descriptive error for a rule naming a fact no vendor row has', async () => {
    await expect(
      BasePriceCalculator.fromRules([
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
      BasePriceCalculator.fromRules([
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
      BasePriceCalculator.fromRules([
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
      BasePriceCalculator.fromRules([
        ruleRow({ id: 9, name: 'no-conditions', conditions: { nope: [] }, event: percent(100) }),
      ]),
    ).rejects.toThrowError(/pricing rule 9 \("no-conditions"\)/);
  });

  it('rejects an empty all, which fires on every row instead of being rejected', async () => {
    await expect(
      BasePriceCalculator.fromRules([
        ruleRow({ id: 4, name: 'typo-for-always', conditions: { all: [] }, event: percent(-3000) }),
      ]),
    ).rejects.toThrowError(/pricing rule 4 \("typo-for-always"\) has an empty all or any/);
  });

  it('rejects an empty any nested under a populated all', async () => {
    await expect(
      BasePriceCalculator.fromRules([
        ruleRow({
          id: 5,
          name: 'nested-typo',
          conditions: {
            all: [{ any: [] }, { fact: 'stockQuantity', operator: 'greaterThan', value: 0 }],
          },
          event: percent(-3000),
        }),
      ]),
    ).rejects.toThrowError(/pricing rule 5 \("nested-typo"\) has an empty all or any/);
  });

  it('applies markup and stock discount in priority order', async () => {
    const rules = await BasePriceCalculator.fromRules([
      ruleRow({
        id: 1,
        name: 'electronics-markup',
        priority: 100,
        conditions: categoryIs('Electronics'),
        event: percent(1500),
      }),
      ruleRow({
        id: 2,
        name: 'bulk-stock-discount',
        priority: 50,
        conditions: stockAbove(100),
        event: percent(-300),
      }),
    ]);

    await expect(rules.calculate(vendorRow())).resolves.toEqual({
      ok: true,
      basePriceCents: 89_240,
      pricingRulesVersion: rules.pricingRulesVersion,
    });
  });

  it('passes the vendor price through when no rule matches', async () => {
    const rules = await BasePriceCalculator.fromRules([
      ruleRow({
        id: 1,
        name: 'electronics-markup',
        conditions: categoryIs('Electronics'),
        event: percent(1500),
      }),
    ]);

    await expect(rules.calculate(vendorRow({ category: 'Apparel' }))).resolves.toEqual({
      ok: true,
      basePriceCents: 80_000,
      pricingRulesVersion: rules.pricingRulesVersion,
    });
  });

  it('applies the higher priority rule first, so priority changes the result', async () => {
    const fee = { name: 'handling-fee', conditions: always, event: cents(1000) };
    const double = { name: 'double', conditions: always, event: percent(10_000) };
    const feeFirst = await BasePriceCalculator.fromRules([
      ruleRow({ id: 1, priority: 100, ...fee }),
      ruleRow({ id: 2, priority: 50, ...double }),
    ]);
    const doubleFirst = await BasePriceCalculator.fromRules([
      ruleRow({ id: 1, priority: 50, ...fee }),
      ruleRow({ id: 2, priority: 100, ...double }),
    ]);
    const cheapRow = vendorRow({ vendorPriceCents: 1000 });

    await expect(feeFirst.calculate(cheapRow)).resolves.toMatchObject({
      basePriceCents: 4000,
    });
    await expect(doubleFirst.calculate(cheapRow)).resolves.toMatchObject({
      basePriceCents: 3000,
    });
  });

  it('floors each step rather than rounding it', async () => {
    const rules = await BasePriceCalculator.fromRules([
      ruleRow({ id: 1, name: 'odd-markup', conditions: always, event: percent(1) }),
    ]);

    // 19999 * 10001 / 10000 = 20000.9999, floored to 20000.
    await expect(rules.calculate(vendorRow({ vendorPriceCents: 19_999 }))).resolves.toMatchObject({
      basePriceCents: 20_000,
    });
  });

  it('keeps a zero vendor price at zero', async () => {
    const rules = await BasePriceCalculator.fromRules([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
    ]);

    await expect(rules.calculate(vendorRow({ vendorPriceCents: 0 }))).resolves.toMatchObject({
      basePriceCents: 0,
    });
  });

  it('prices the largest exact price without losing a cent', async () => {
    const rules = await BasePriceCalculator.fromRules([
      ruleRow({ id: 1, name: 'half-off', conditions: always, event: percent(-5000) }),
    ]);

    await expect(
      rules.calculate(vendorRow({ vendorPriceCents: Number.MAX_SAFE_INTEGER - 1 })),
    ).resolves.toMatchObject({ basePriceCents: (Number.MAX_SAFE_INTEGER - 1) / 2 });
  });

  it('rejects the row when a rule drives the price past the largest exact cent value', async () => {
    const rules = await BasePriceCalculator.fromRules([
      ruleRow({ id: 1, name: 'runaway-markup', conditions: always, event: percent(1) }),
    ]);

    const outcome = await rules.calculate(vendorRow({ vendorPriceCents: Number.MAX_SAFE_INTEGER }));

    expect(outcome).toMatchObject({
      ok: false,
      fault: 'row',
      rejectedBy: 'pricing rule 1 ("runaway-markup")',
    });
    expect(outcome.ok === false && outcome.reason).toMatch(/above the largest exact cent value/);
  });

  it('rejects the row and names the rule when a rule drives the price below zero', async () => {
    const rules = await BasePriceCalculator.fromRules([
      ruleRow({
        id: 1,
        name: 'electronics-markup',
        priority: 100,
        conditions: categoryIs('Electronics'),
        event: percent(1500),
      }),
      ruleRow({
        id: 2,
        name: 'clearance-rebate',
        priority: 50,
        conditions: always,
        event: cents(-100_000),
      }),
    ]);

    await expect(rules.calculate(vendorRow())).resolves.toEqual({
      ok: false,
      fault: 'row',
      rejectedBy: 'pricing rule 2 ("clearance-rebate")',
      reason: 'price -8000 is below zero',
    });
  });

  it.each([
    ['a fractional price', 1000.5],
    ['a negative price', -1],
    ['a price beyond the exact range', Number.MAX_SAFE_INTEGER + 2],
    ['a non-number price', Number.NaN],
  ])('rejects %s instead of throwing', async (_case, vendorPriceCents) => {
    const rules = await BasePriceCalculator.fromRules([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
    ]);

    const outcome = await rules.calculate(vendorRow({ vendorPriceCents }));

    expect(outcome).toMatchObject({ ok: false, fault: 'row', rejectedBy: null });
    expect(outcome.ok === false && outcome.reason).toMatch(/vendorPriceCents/);
  });

  it('matches a padded category, rather than pricing it as if it were another one', async () => {
    const rules = await BasePriceCalculator.fromRules([
      ruleRow({
        id: 1,
        name: 'markup',
        conditions: categoryIs('Electronics'),
        event: percent(1500),
      }),
    ]);

    await expect(
      rules.calculate(vendorRow({ category: '  Electronics  ' })),
    ).resolves.toMatchObject({ basePriceCents: 92_000 });
  });

  it('rejects a category of nothing but spaces', async () => {
    const rules = await BasePriceCalculator.fromRules([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
    ]);

    const outcome = await rules.calculate(vendorRow({ category: '   ' }));

    expect(outcome).toMatchObject({ ok: false, fault: 'row', rejectedBy: null });
    expect(outcome.ok === false && outcome.reason).toMatch(/category/);
  });

  it('rejects an empty category rather than matching a rule against nothing', async () => {
    const rules = await BasePriceCalculator.fromRules([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
    ]);

    const outcome = await rules.calculate(vendorRow({ category: '' }));

    expect(outcome).toMatchObject({ ok: false, fault: 'row', rejectedBy: null });
    expect(outcome.ok === false && outcome.reason).toMatch(/category/);
  });

  it("rejects a row missing a fact as the row's fault, not the rule set's", async () => {
    const rules = await BasePriceCalculator.fromRules([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
    ]);
    const partial = { category: 'Electronics', vendorPriceCents: 80_000 };

    const outcome = await rules.calculate(partial as VendorRowFacts);

    expect(outcome).toMatchObject({ ok: false, fault: 'row', rejectedBy: null });
    expect(outcome.ok === false && outcome.reason).toMatch(/stockQuantity/);
  });

  it('rejects a row whose fact is null instead of silently skipping the rule', async () => {
    const rules = await BasePriceCalculator.fromRules([
      ruleRow({
        id: 1,
        name: 'markup',
        conditions: categoryIs('Electronics'),
        event: percent(1500),
      }),
    ]);

    const outcome = await rules.calculate(vendorRow({ category: null as unknown as string }));

    expect(outcome).toMatchObject({ ok: false, fault: 'row', rejectedBy: null });
    expect(outcome.ok === false && outcome.reason).toMatch(/category/);
  });

  it('applies equal-priority rules in a total order, whatever the row order', async () => {
    const fee = { name: 'handling-fee', conditions: always, event: cents(1000) };
    const double = { name: 'double', conditions: always, event: percent(10_000) };
    const feeFirst = await BasePriceCalculator.fromRules([
      ruleRow({ id: 1, priority: 0, ...fee }),
      ruleRow({ id: 2, priority: 0, ...double }),
    ]);
    const feeFirstReversed = await BasePriceCalculator.fromRules([
      ruleRow({ id: 2, priority: 0, ...double }),
      ruleRow({ id: 1, priority: 0, ...fee }),
    ]);
    const cheapRow = vendorRow({ vendorPriceCents: 1000 });

    await expect(feeFirst.calculate(cheapRow)).resolves.toMatchObject({
      basePriceCents: 4000,
    });
    await expect(feeFirstReversed.calculate(cheapRow)).resolves.toMatchObject({
      basePriceCents: 4000,
    });
  });

  it('reports an engine that fails with a non-error without throwing itself', async () => {
    const engine = new Engine();
    engine.addFact('rude', () => Promise.reject('just a string'));
    engine.addRule({
      name: 'rude',
      priority: 1000,
      conditions: { all: [{ fact: 'rude', operator: 'equal', value: 1 }] },
      event: cents(0),
    });
    const rules = new BasePriceCalculator(engine, [1], 1);

    await expect(rules.calculate(vendorRow())).resolves.toMatchObject({
      ok: false,
      fault: 'rules',
      reason: 'just a string',
    });
    // The engine is spent by that failure too, or the next row prices short.
    await expect(rules.calculate(vendorRow())).resolves.toMatchObject({
      ok: false,
      fault: 'rules',
    });
  });

  it('turns an engine failure into a rejection rather than letting it escape', async () => {
    const exploding = new BasePriceCalculator(
      { run: () => Promise.reject(new Error('engine exploded')) } as unknown as Engine,
      [1],
      1,
    );

    await expect(exploding.calculate(vendorRow())).resolves.toEqual({
      ok: false,
      fault: 'rules',
      rejectedBy: null,
      reason: 'engine exploded',
    });
  });

  it('carries the rule ids and the version the compiler gave it', () => {
    const rules = new BasePriceCalculator(new Engine(), [7, 9], 1_700_000_000_000);

    expect(rules.ruleIds).toEqual([7, 9]);
    expect(rules.pricingRulesVersion).toBe(1_700_000_000_000);
  });
});
