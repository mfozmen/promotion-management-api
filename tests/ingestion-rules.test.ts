import { describe, expect, it, vi } from 'vitest';
import {
  compileRules,
  createRuleSetLoader,
  priceRow,
  type PricingRuleRow,
  type VendorRowFacts,
} from '../src/modules/pricing/ingestion-rules.js';

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

    expect(compiled.pricingRulesVersion).toBe(
      Math.floor(Date.parse('2026-09-02T00:00:10.000Z') / 1000),
    );
  });

  it('refuses an empty rule set rather than pricing a catalogue at vendor cost', async () => {
    await expect(compileRules([])).rejects.toThrowError(/no active ingestion pricing rules/);
  });

  it('refuses a rule set whose every row is inactive', async () => {
    await expect(
      compileRules([
        ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500), active: false }),
      ]),
    ).rejects.toThrowError(/no active ingestion pricing rules/);
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

describe('priceRow', () => {
  it('applies markup and stock discount in priority order', async () => {
    const rules = await compileRules([
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

    await expect(priceRow(rules, vendorRow())).resolves.toEqual({
      ok: true,
      basePriceCents: 89_240,
      pricingRulesVersion: rules.pricingRulesVersion,
    });
  });

  it('passes the vendor price through when no rule matches', async () => {
    const rules = await compileRules([
      ruleRow({
        id: 1,
        name: 'electronics-markup',
        conditions: categoryIs('Electronics'),
        event: percent(1500),
      }),
    ]);

    await expect(priceRow(rules, vendorRow({ category: 'Apparel' }))).resolves.toEqual({
      ok: true,
      basePriceCents: 80_000,
      pricingRulesVersion: rules.pricingRulesVersion,
    });
  });

  it('applies the higher priority rule first, so priority changes the result', async () => {
    const fee = { name: 'handling-fee', conditions: always, event: cents(1000) };
    const double = { name: 'double', conditions: always, event: percent(10_000) };
    const feeFirst = await compileRules([
      ruleRow({ id: 1, priority: 100, ...fee }),
      ruleRow({ id: 2, priority: 50, ...double }),
    ]);
    const doubleFirst = await compileRules([
      ruleRow({ id: 1, priority: 50, ...fee }),
      ruleRow({ id: 2, priority: 100, ...double }),
    ]);
    const cheapRow = vendorRow({ vendorPriceCents: 1000 });

    await expect(priceRow(feeFirst, cheapRow)).resolves.toMatchObject({ basePriceCents: 4000 });
    await expect(priceRow(doubleFirst, cheapRow)).resolves.toMatchObject({ basePriceCents: 3000 });
  });

  it('floors each step rather than rounding it', async () => {
    const rules = await compileRules([
      ruleRow({ id: 1, name: 'odd-markup', conditions: always, event: percent(1) }),
    ]);

    // 19999 * 10001 / 10000 = 20000.9999, floored to 20000.
    await expect(priceRow(rules, vendorRow({ vendorPriceCents: 19_999 }))).resolves.toMatchObject({
      basePriceCents: 20_000,
    });
  });

  it('keeps a zero vendor price at zero', async () => {
    const rules = await compileRules([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
    ]);

    await expect(priceRow(rules, vendorRow({ vendorPriceCents: 0 }))).resolves.toMatchObject({
      basePriceCents: 0,
    });
  });

  it('prices the largest exact price without losing a cent', async () => {
    const rules = await compileRules([
      ruleRow({ id: 1, name: 'half-off', conditions: always, event: percent(-5000) }),
    ]);

    await expect(
      priceRow(rules, vendorRow({ vendorPriceCents: Number.MAX_SAFE_INTEGER - 1 })),
    ).resolves.toMatchObject({ basePriceCents: (Number.MAX_SAFE_INTEGER - 1) / 2 });
  });

  it('rejects the row when a rule drives the price past the largest exact cent value', async () => {
    const rules = await compileRules([
      ruleRow({ id: 1, name: 'runaway-markup', conditions: always, event: percent(1) }),
    ]);

    const outcome = await priceRow(rules, vendorRow({ vendorPriceCents: Number.MAX_SAFE_INTEGER }));

    expect(outcome).toMatchObject({
      ok: false,
      fault: 'row',
      rejectedBy: 'pricing rule 1 ("runaway-markup")',
    });
    expect(outcome.ok === false && outcome.reason).toMatch(/above the largest exact cent value/);
  });

  it('rejects the row and names the rule when a rule drives the price below zero', async () => {
    const rules = await compileRules([
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

    await expect(priceRow(rules, vendorRow())).resolves.toEqual({
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
    const rules = await compileRules([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
    ]);

    const outcome = await priceRow(rules, vendorRow({ vendorPriceCents }));

    expect(outcome).toMatchObject({ ok: false, fault: 'row', rejectedBy: null });
    expect(outcome.ok === false && outcome.reason).toMatch(/vendorPriceCents/);
  });

  it('rejects an empty category rather than matching a rule against nothing', async () => {
    const rules = await compileRules([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
    ]);

    const outcome = await priceRow(rules, vendorRow({ category: '' }));

    expect(outcome).toMatchObject({ ok: false, fault: 'row', rejectedBy: null });
    expect(outcome.ok === false && outcome.reason).toMatch(/category/);
  });

  it("rejects a row missing a fact as the row's fault, not the rule set's", async () => {
    const rules = await compileRules([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
    ]);
    const partial = { category: 'Electronics', vendorPriceCents: 80_000 };

    const outcome = await priceRow(rules, partial as VendorRowFacts);

    expect(outcome).toMatchObject({ ok: false, fault: 'row', rejectedBy: null });
    expect(outcome.ok === false && outcome.reason).toMatch(/stockQuantity/);
  });

  it('rejects a row whose fact is null instead of silently skipping the rule', async () => {
    const rules = await compileRules([
      ruleRow({
        id: 1,
        name: 'markup',
        conditions: categoryIs('Electronics'),
        event: percent(1500),
      }),
    ]);

    const outcome = await priceRow(rules, vendorRow({ category: null as unknown as string }));

    expect(outcome).toMatchObject({ ok: false, fault: 'row', rejectedBy: null });
    expect(outcome.ok === false && outcome.reason).toMatch(/category/);
  });

  it('prices overlapping calls on one rule set without dropping a rule', async () => {
    const rules = await compileRules([
      ruleRow({
        id: 1,
        name: 'markup',
        priority: 100,
        conditions: categoryIs('Electronics'),
        event: percent(1500),
      }),
      ruleRow({
        id: 2,
        name: 'bulk',
        priority: 50,
        conditions: stockAbove(100),
        event: percent(-300),
      }),
      ruleRow({ id: 3, name: 'commission', priority: 10, conditions: always, event: percent(500) }),
    ]);
    // A fact whose first evaluation yields to the event loop, so a second run
    // started meanwhile finishes first and the engine marks itself finished
    // under the first run's feet.
    let calls = 0;
    rules.engine.addFact('slow', () =>
      calls++ === 0
        ? new Promise((resolve) => setImmediate(() => resolve(true)))
        : Promise.resolve(true),
    );
    rules.engine.addRule({
      name: 'slow',
      priority: 1000,
      conditions: { all: [{ fact: 'slow', operator: 'equal', value: true }] },
      event: cents(0),
    });

    const outcomes = await Promise.all([
      priceRow(rules, vendorRow()),
      priceRow(rules, vendorRow()),
    ]);

    expect(outcomes.map((outcome) => outcome.ok && outcome.basePriceCents)).toEqual([
      93_702, 93_702,
    ]);
  });

  it('applies equal-priority rules in a total order, whatever the row order', async () => {
    const fee = { name: 'handling-fee', conditions: always, event: cents(1000) };
    const double = { name: 'double', conditions: always, event: percent(10_000) };
    const feeFirst = await compileRules([
      ruleRow({ id: 1, priority: 0, ...fee }),
      ruleRow({ id: 2, priority: 0, ...double }),
    ]);
    const feeFirstReversed = await compileRules([
      ruleRow({ id: 2, priority: 0, ...double }),
      ruleRow({ id: 1, priority: 0, ...fee }),
    ]);
    const cheapRow = vendorRow({ vendorPriceCents: 1000 });

    // The lower id wins the tie, so both compilations price identically.
    await expect(priceRow(feeFirst, cheapRow)).resolves.toMatchObject({ basePriceCents: 4000 });
    await expect(priceRow(feeFirstReversed, cheapRow)).resolves.toMatchObject({
      basePriceCents: 4000,
    });
  });

  it('keeps reporting a rules fault after one, rather than mispricing the next row', async () => {
    const rules = await compileRules([
      ruleRow({ id: 1, name: 'markup', conditions: always, event: percent(1500) }),
    ]);
    // A fact that fails once. The failed run keeps evaluating in the background
    // and marks the engine finished under the next run's feet, which would drop
    // that run's remaining rules and price the row as if no rule matched.
    let failing = true;
    rules.engine.addFact('flaky', () => {
      if (!failing) return Promise.resolve(1);
      failing = false;
      return Promise.reject(new Error('fact blew up'));
    });
    rules.engine.addRule({
      name: 'flaky',
      priority: 1000,
      conditions: { all: [{ fact: 'flaky', operator: 'equal', value: 1 }] },
      event: cents(0),
    });

    const first = await priceRow(rules, vendorRow());
    const second = await priceRow(rules, vendorRow());

    expect(first).toMatchObject({ ok: false, fault: 'rules' });
    expect(second).toMatchObject({ ok: false, fault: 'rules', reason: 'fact blew up' });
  });

  it('turns an engine failure into a rejection rather than letting it escape', async () => {
    const exploding = {
      pricingRulesVersion: 1,
      engine: { run: () => Promise.reject(new Error('engine exploded')) },
    } as unknown as Awaited<ReturnType<typeof compileRules>>;

    await expect(priceRow(exploding, vendorRow())).resolves.toEqual({
      ok: false,
      fault: 'rules',
      rejectedBy: null,
      reason: 'engine exploded',
    });
  });
});

describe('the seeded case-study rules', () => {
  // Mirrors migration 0001: +15 % on Electronics, -3 % above 100 units, +5 % commission.
  // The rows themselves are read from the database by the integration test.
  const seeded = () =>
    compileRules([
      ruleRow({
        id: 1,
        name: 'electronics category markup',
        priority: 30,
        conditions: categoryIs('Electronics'),
        event: percent(1500),
      }),
      ruleRow({
        id: 2,
        name: 'bulk stock discount',
        priority: 20,
        conditions: stockAbove(100),
        event: percent(-300),
      }),
      ruleRow({
        id: 3,
        name: 'vendor commission',
        priority: 10,
        conditions: always,
        event: percent(500),
      }),
    ]);

  it('marks up electronics, discounts bulk stock and adds the vendor commission', async () => {
    // 80000 +15 % = 92000, -3 % = 89240, +5 % commission = 93702.
    await expect(priceRow(await seeded(), vendorRow())).resolves.toMatchObject({
      basePriceCents: 93_702,
    });
  });

  it('leaves a non-electronics row with low stock to the commission alone', async () => {
    await expect(
      priceRow(await seeded(), vendorRow({ category: 'Apparel', stockQuantity: 10 })),
    ).resolves.toMatchObject({ basePriceCents: 84_000 });
  });
});

describe('createRuleSetLoader', () => {
  const rowsAt = (iso: string): PricingRuleRow[] => [
    ruleRow({
      id: 1,
      name: 'markup',
      conditions: always,
      event: percent(1500),
      updatedAt: at(iso),
    }),
  ];

  it('serves the cached rule set within the cache window', async () => {
    const load = vi.fn().mockResolvedValue(rowsAt('2026-09-01T00:00:00.000Z'));
    let now = 1_000_000;
    const loader = createRuleSetLoader({ load, now: () => now });

    const first = await loader();
    now += 59_999;
    const second = await loader();

    expect(second).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('recompiles once the cache entry has expired', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(rowsAt('2026-09-01T00:00:00.000Z'))
      .mockResolvedValueOnce(rowsAt('2026-09-05T00:00:00.000Z'));
    let now = 1_000_000;
    const loader = createRuleSetLoader({ load, now: () => now });

    const first = await loader();
    now += 60_000;
    const second = await loader();

    expect(load).toHaveBeenCalledTimes(2);
    expect(second.pricingRulesVersion).toBeGreaterThan(first.pricingRulesVersion);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const load = vi.fn().mockResolvedValue(rowsAt('2026-09-01T00:00:00.000Z'));
    const loader = createRuleSetLoader({ load, now: () => 0 });

    const [a, b] = await Promise.all([loader(), loader()]);

    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed load', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValue(rowsAt('2026-09-01T00:00:00.000Z'));
    const loader = createRuleSetLoader({ load, now: () => 0 });

    await expect(loader()).rejects.toThrowError('database down');
    await expect(loader()).resolves.toMatchObject({ pricingRulesVersion: expect.any(Number) });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
