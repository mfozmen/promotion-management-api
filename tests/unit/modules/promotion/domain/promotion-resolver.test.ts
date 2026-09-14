import { Engine } from 'json-rules-engine';
import { describe, expect, it } from 'vitest';
import { PromotionResolver } from '@src/modules/promotion/domain/promotion-resolver.js';
import type { PromotionRuleRow } from '@src/modules/promotion/domain/dto/promotion-rule-row.js';
import { captureLogger } from '../../../capture-logger.js';

const both = (rest: unknown[]) => ({
  all: [
    { fact: 'productPriceCents', operator: 'notEqual', value: null },
    { fact: 'categoryPriceCents', operator: 'notEqual', value: null },
    ...rest,
  ],
});

const rule = (over: Partial<PromotionRuleRow> = {}): PromotionRuleRow => ({
  id: 1,
  type: 'promotion',
  name: 'lower-price-product',
  conditions: both([
    {
      fact: 'productPriceCents',
      operator: 'lessThanInclusive',
      value: { fact: 'categoryPriceCents' },
    },
  ]),
  event: { type: 'selectCandidate', params: { level: 'product' } },
  priority: 20,
  active: true,
  updatedAt: new Date('2026-09-14T00:00:00.000Z'),
  ...over,
});

const categoryWins = rule({
  id: 2,
  name: 'lower-price-category',
  conditions: both([
    { fact: 'categoryPriceCents', operator: 'lessThan', value: { fact: 'productPriceCents' } },
  ]),
  event: { type: 'selectCandidate', params: { level: 'category' } },
  priority: 15,
});

const productOnly = rule({
  id: 3,
  name: 'product-only',
  conditions: {
    all: [
      { fact: 'productPriceCents', operator: 'notEqual', value: null },
      { fact: 'categoryPriceCents', operator: 'equal', value: null },
    ],
  },
  priority: 30,
});

const policy = [rule(), categoryWins, productOnly];

const facts = (productPriceCents: number | null, categoryPriceCents: number | null) => ({
  category: 'knitwear',
  stockQuantity: 5,
  basePriceCents: 10_000,
  productPriceCents,
  categoryPriceCents,
});

const resolverOf = async (rows: PromotionRuleRow[]) =>
  PromotionResolver.fromRules(rows, captureLogger().logger);

describe('PromotionResolver', () => {
  it('picks the cheaper of two candidates, which is what a sale promises a shopper', async () => {
    const resolver = await resolverOf(policy);

    await expect(resolver.select(facts(5_000, 8_000))).resolves.toBe('product');
    await expect(resolver.select(facts(9_000, 8_000))).resolves.toBe('category');
  });

  it('breaks a tie the way the row spells it, not with an id', async () => {
    const resolver = await resolverOf(policy);

    await expect(resolver.select(facts(8_000, 8_000))).resolves.toBe('product');
  });

  it('sends a product with one candidate through the rules too', async () => {
    const resolver = await resolverOf(policy);

    await expect(resolver.select(facts(9_000, null))).resolves.toBe('product');
  });

  it('applies nothing when no rule fired', async () => {
    const resolver = await resolverOf(policy);

    await expect(resolver.select(facts(null, null))).resolves.toBeUndefined();
  });

  it('takes the highest-priority match rather than the first result', async () => {
    const keepProduct = rule({
      id: 4,
      name: 'accessories keep their own price',
      conditions: both([{ fact: 'category', operator: 'equal', value: 'accessories' }]),
      event: { type: 'selectCandidate', params: { level: 'product' } },
      priority: 40,
    });
    const resolver = await resolverOf([...policy, keepProduct]);

    const inAccessories = { ...facts(9_000, 1_000), category: 'accessories' };
    await expect(resolver.select(inAccessories)).resolves.toBe('product');
  });

  it('reads the priority the library reports, which is the rule row own priority', async () => {
    // Probed against the installed json-rules-engine: `results` carries the
    // rule's priority, which is what the selection above depends on.
    const engine = new Engine();
    engine.addRule({
      name: 'probe',
      priority: 17,
      conditions: { all: [{ fact: 'category', operator: 'equal', value: 'knitwear' }] },
      event: { type: 'selectCandidate', params: { level: 'product' } },
    });

    const { results } = await engine.run(facts(1, 2));

    expect(results[0]?.priority).toBe(17);
  });

  it('ignores a deactivated rule and a rule from the other layer', async () => {
    const resolver = await resolverOf([
      ...policy,
      rule({ id: 5, name: 'off', priority: 99, active: false }),
      rule({ id: 6, name: 'ingestion markup', type: 'ingestion', priority: 99 }),
    ]);

    await expect(resolver.select(facts(9_000, 8_000))).resolves.toBe('category');
  });

  it('refuses a rule whose event is not a candidate selection, naming the row', async () => {
    const carriesAPrice = rule({
      id: 7,
      name: 'discounts by itself',
      event: { type: 'adjustPercentBps', params: { value: 500 } },
    });

    await expect(resolverOf([carriesAPrice])).rejects.toThrow(
      /promotion rule 7 \("discounts by itself"\) has a malformed event/,
    );
  });

  it('refuses to start with no promotion rule to read', async () => {
    await expect(resolverOf([])).rejects.toThrow(/no active promotion/i);
  });

  it('says so when two rules share a priority, because then the policy is not deciding', async () => {
    const { logger, lines } = captureLogger();

    await PromotionResolver.fromRules(
      [rule(), rule({ id: 2, name: 'also 20', priority: 20 })],
      logger,
    );

    expect(lines[0]).toMatchObject({ level: 40 });
  });

  it('names the rules it loaded, so a log line can say which policy priced a product', async () => {
    const resolver = await resolverOf(policy);

    expect(resolver.ruleIds).toEqual([3, 1, 2]);
  });
});
