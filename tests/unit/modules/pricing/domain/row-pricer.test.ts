import { Engine } from 'json-rules-engine';
import { describe, expect, it } from 'vitest';
import { CompiledRuleSet } from '@src/modules/pricing/domain/compiled-rule-set.js';
import { RuleCompiler } from '@src/modules/pricing/domain/rule-compiler.js';
import { RowPricer } from '@src/modules/pricing/domain/row-pricer.js';
import type { VendorRowFacts } from '@src/modules/pricing/domain/dto/vendor-row-facts.js';
import type { PricingRuleRow } from '@src/modules/pricing/domain/dto/pricing-rule-row.js';

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

const stockAbove = (n: number) => ({
  all: [{ fact: 'stockQuantity', operator: 'greaterThan', value: n }],
});

const always = {
  all: [{ fact: 'vendorPriceCents', operator: 'greaterThanInclusive', value: 0 }],
};

const percent = (bps: number) => ({ type: 'adjustPercentBps', params: { value: bps } });

const cents = (value: number) => ({ type: 'adjustCents', params: { value } });

const vendorRow = (over: Partial<VendorRowFacts> = {}): VendorRowFacts => ({
  category: 'Electronics',
  vendorPriceCents: 80_000,
  stockQuantity: 150,
  ...over,
});

describe('RowPricer', () => {
  it('applies markup and stock discount in priority order', async () => {
    const rules = await new RuleCompiler().compile([
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

    await expect(new RowPricer(rules).price(vendorRow())).resolves.toEqual({
      ok: true,
      basePriceCents: 89_240,
      pricingRulesVersion: rules.pricingRulesVersion,
    });
  });

  it('passes the vendor price through when no rule matches', async () => {
    const rules = await new RuleCompiler().compile([
      ruleRow({
        id: 1,
        name: 'electronics-markup',
        conditions: categoryIs('Electronics'),
        event: percent(1500),
      }),
    ]);

    await expect(new RowPricer(rules).price(vendorRow({ category: 'Apparel' }))).resolves.toEqual({
      ok: true,
      basePriceCents: 80_000,
      pricingRulesVersion: rules.pricingRulesVersion,
    });
  });

  it('applies the higher priority rule first, so priority changes the result', async () => {
    const fee = { name: 'handling-fee', conditions: always, event: cents(1000) };
    const double = { name: 'double', conditions: always, event: percent(10_000) };
    const feeFirst = await new RuleCompiler().compile([
      ruleRow({ id: 1, priority: 100, ...fee }),
      ruleRow({ id: 2, priority: 50, ...double }),
    ]);
    const doubleFirst = await new RuleCompiler().compile([
      ruleRow({ id: 1, priority: 50, ...fee }),
      ruleRow({ id: 2, priority: 100, ...double }),
    ]);
    const cheapRow = vendorRow({ vendorPriceCents: 1000 });

    await expect(new RowPricer(feeFirst).price(cheapRow)).resolves.toMatchObject({
      basePriceCents: 4000,
    });
    await expect(new RowPricer(doubleFirst).price(cheapRow)).resolves.toMatchObject({
      basePriceCents: 3000,
    });
  });

  it('floors each step rather than rounding it', async () => {
    const rules = await new RuleCompiler().compile([
      ruleRow({ id: 1, name: 'odd-markup', conditions: always, event: percent(1) }),
    ]);

    // 19999 * 10001 / 10000 = 20000.9999, floored to 20000.
    await expect(
      new RowPricer(rules).price(vendorRow({ vendorPriceCents: 19_999 })),
    ).resolves.toMatchObject({
      basePriceCents: 20_000,
    });
  });

  it('keeps a zero vendor price at zero', async () => {
    const rules = await new RuleCompiler().compile([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
    ]);

    await expect(
      new RowPricer(rules).price(vendorRow({ vendorPriceCents: 0 })),
    ).resolves.toMatchObject({
      basePriceCents: 0,
    });
  });

  it('prices the largest exact price without losing a cent', async () => {
    const rules = await new RuleCompiler().compile([
      ruleRow({ id: 1, name: 'half-off', conditions: always, event: percent(-5000) }),
    ]);

    await expect(
      new RowPricer(rules).price(vendorRow({ vendorPriceCents: Number.MAX_SAFE_INTEGER - 1 })),
    ).resolves.toMatchObject({ basePriceCents: (Number.MAX_SAFE_INTEGER - 1) / 2 });
  });

  it('rejects the row when a rule drives the price past the largest exact cent value', async () => {
    const rules = await new RuleCompiler().compile([
      ruleRow({ id: 1, name: 'runaway-markup', conditions: always, event: percent(1) }),
    ]);

    const outcome = await new RowPricer(rules).price(
      vendorRow({ vendorPriceCents: Number.MAX_SAFE_INTEGER }),
    );

    expect(outcome).toMatchObject({
      ok: false,
      fault: 'row',
      rejectedBy: 'pricing rule 1 ("runaway-markup")',
    });
    expect(outcome.ok === false && outcome.reason).toMatch(/above the largest exact cent value/);
  });

  it('rejects the row and names the rule when a rule drives the price below zero', async () => {
    const rules = await new RuleCompiler().compile([
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

    await expect(new RowPricer(rules).price(vendorRow())).resolves.toEqual({
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
    const rules = await new RuleCompiler().compile([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
    ]);

    const outcome = await new RowPricer(rules).price(vendorRow({ vendorPriceCents }));

    expect(outcome).toMatchObject({ ok: false, fault: 'row', rejectedBy: null });
    expect(outcome.ok === false && outcome.reason).toMatch(/vendorPriceCents/);
  });

  it('matches a padded category, rather than pricing it as if it were another one', async () => {
    const rules = await new RuleCompiler().compile([
      ruleRow({
        id: 1,
        name: 'markup',
        conditions: categoryIs('Electronics'),
        event: percent(1500),
      }),
    ]);

    await expect(
      new RowPricer(rules).price(vendorRow({ category: '  Electronics  ' })),
    ).resolves.toMatchObject({ basePriceCents: 92_000 });
  });

  it('rejects a category of nothing but spaces', async () => {
    const rules = await new RuleCompiler().compile([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
    ]);

    const outcome = await new RowPricer(rules).price(vendorRow({ category: '   ' }));

    expect(outcome).toMatchObject({ ok: false, fault: 'row', rejectedBy: null });
    expect(outcome.ok === false && outcome.reason).toMatch(/category/);
  });

  it('rejects an empty category rather than matching a rule against nothing', async () => {
    const rules = await new RuleCompiler().compile([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
    ]);

    const outcome = await new RowPricer(rules).price(vendorRow({ category: '' }));

    expect(outcome).toMatchObject({ ok: false, fault: 'row', rejectedBy: null });
    expect(outcome.ok === false && outcome.reason).toMatch(/category/);
  });

  it("rejects a row missing a fact as the row's fault, not the rule set's", async () => {
    const rules = await new RuleCompiler().compile([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
    ]);
    const partial = { category: 'Electronics', vendorPriceCents: 80_000 };

    const outcome = await new RowPricer(rules).price(partial as VendorRowFacts);

    expect(outcome).toMatchObject({ ok: false, fault: 'row', rejectedBy: null });
    expect(outcome.ok === false && outcome.reason).toMatch(/stockQuantity/);
  });

  it('rejects a row whose fact is null instead of silently skipping the rule', async () => {
    const rules = await new RuleCompiler().compile([
      ruleRow({
        id: 1,
        name: 'markup',
        conditions: categoryIs('Electronics'),
        event: percent(1500),
      }),
    ]);

    const outcome = await new RowPricer(rules).price(
      vendorRow({ category: null as unknown as string }),
    );

    expect(outcome).toMatchObject({ ok: false, fault: 'row', rejectedBy: null });
    expect(outcome.ok === false && outcome.reason).toMatch(/category/);
  });

  it('applies equal-priority rules in a total order, whatever the row order', async () => {
    const fee = { name: 'handling-fee', conditions: always, event: cents(1000) };
    const double = { name: 'double', conditions: always, event: percent(10_000) };
    const feeFirst = await new RuleCompiler().compile([
      ruleRow({ id: 1, priority: 0, ...fee }),
      ruleRow({ id: 2, priority: 0, ...double }),
    ]);
    const feeFirstReversed = await new RuleCompiler().compile([
      ruleRow({ id: 2, priority: 0, ...double }),
      ruleRow({ id: 1, priority: 0, ...fee }),
    ]);
    const cheapRow = vendorRow({ vendorPriceCents: 1000 });

    // The lower id wins the tie, so both compilations price identically.
    await expect(new RowPricer(feeFirst).price(cheapRow)).resolves.toMatchObject({
      basePriceCents: 4000,
    });
    await expect(new RowPricer(feeFirstReversed).price(cheapRow)).resolves.toMatchObject({
      basePriceCents: 4000,
    });
  });

  it('reports an engine that fails with a non-error without throwing itself', async () => {
    // Built here rather than through the compiler: the engine belongs to CompiledRuleSet,
    // and what this asserts is the pricer's answer to a rejected run.
    const engine = new Engine();
    engine.addFact('rude', () => Promise.reject('just a string'));
    engine.addRule({
      name: 'rude',
      priority: 1000,
      conditions: { all: [{ fact: 'rude', operator: 'equal', value: 1 }] },
      event: cents(0),
    });
    const rules = new CompiledRuleSet(engine, [1], 1);

    await expect(new RowPricer(rules).price(vendorRow())).resolves.toMatchObject({
      ok: false,
      fault: 'rules',
      reason: 'just a string',
    });
    // The engine is spent by that failure too, or the next row prices short.
    await expect(new RowPricer(rules).price(vendorRow())).resolves.toMatchObject({
      ok: false,
      fault: 'rules',
    });
  });

  it('turns an engine failure into a rejection rather than letting it escape', async () => {
    const exploding = new CompiledRuleSet(
      { run: () => Promise.reject(new Error('engine exploded')) } as unknown as Engine,
      [1],
      1,
    );

    await expect(new RowPricer(exploding).price(vendorRow())).resolves.toEqual({
      ok: false,
      fault: 'rules',
      rejectedBy: null,
      reason: 'engine exploded',
    });
  });
});
