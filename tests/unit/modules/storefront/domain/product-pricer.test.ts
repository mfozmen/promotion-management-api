import { describe, expect, it } from 'vitest';
import { ProductPricer } from '@src/modules/storefront/domain/product-pricer.js';
import { PromotionResolver } from '@src/modules/promotion/domain/promotion-resolver.js';
import { EffectivePriceCalculator } from '@src/modules/promotion/domain/effective-price-calculator.js';
import type { SourceRow } from '@src/modules/storefront/domain/dto/source-row.js';
import type { PromotionRuleRow } from '@src/modules/promotion/domain/dto/promotion-rule-row.js';
import { captureLogger } from '../../../capture-logger.js';

const bothPresent = (rest: unknown[]) => ({
  all: [
    { fact: 'productPriceCents', operator: 'notEqual', value: null },
    { fact: 'categoryPriceCents', operator: 'notEqual', value: null },
    ...rest,
  ],
});

const policy: PromotionRuleRow[] = [
  {
    id: 1,
    type: 'promotion',
    name: 'product-only',
    conditions: {
      all: [
        { fact: 'productPriceCents', operator: 'notEqual', value: null },
        { fact: 'categoryPriceCents', operator: 'equal', value: null },
      ],
    },
    event: { type: 'selectCandidate', params: { level: 'product' } },
    priority: 30,
    active: true,
    updatedAt: new Date(),
  },
  {
    id: 2,
    type: 'promotion',
    name: 'category-only',
    conditions: {
      all: [
        { fact: 'productPriceCents', operator: 'equal', value: null },
        { fact: 'categoryPriceCents', operator: 'notEqual', value: null },
      ],
    },
    event: { type: 'selectCandidate', params: { level: 'category' } },
    priority: 25,
    active: true,
    updatedAt: new Date(),
  },
  {
    id: 3,
    type: 'promotion',
    name: 'lower-price-product',
    conditions: bothPresent([
      {
        fact: 'productPriceCents',
        operator: 'lessThanInclusive',
        value: { fact: 'categoryPriceCents' },
      },
    ]),
    event: { type: 'selectCandidate', params: { level: 'product' } },
    priority: 20,
    active: true,
    updatedAt: new Date(),
  },
  {
    id: 4,
    type: 'promotion',
    name: 'lower-price-category',
    conditions: bothPresent([
      { fact: 'categoryPriceCents', operator: 'lessThan', value: { fact: 'productPriceCents' } },
    ]),
    event: { type: 'selectCandidate', params: { level: 'category' } },
    priority: 15,
    active: true,
    updatedAt: new Date(),
  },
];

const row = (over: Partial<SourceRow> = {}): SourceRow => ({
  id: 7,
  sku: 'SKU-7',
  name: 'Kazak',
  category: 'knitwear',
  basePriceCents: 10_000,
  stockQuantity: 5,
  pricingRulesVersion: 1_789_238_046,
  productPromotion: null,
  categoryPromotion: null,
  ...over,
});

const half = { id: 11, name: 'Half off', discountType: 'percentage' as const, value: 5_000 };
const tenPercent = { id: 12, name: 'Ten off', discountType: 'percentage' as const, value: 1_000 };

async function pricer(lines?: Record<string, unknown>[]) {
  const captured = captureLogger();
  if (lines) captured.lines = lines;
  const resolver = await PromotionResolver.fromRules(policy, captured.logger);

  return {
    pricer: new ProductPricer(resolver, new EffectivePriceCalculator(), captured.logger),
    lines: captured.lines,
  };
}

describe('ProductPricer', () => {
  it('prices a product at its base when nothing is running', async () => {
    const { pricer: price } = await pricer();

    await expect(price.price(row())).resolves.toMatchObject({
      basePriceCents: 10_000,
      effectivePriceCents: 10_000,
    });
  });

  it('names the promotion it applied, so any price can be explained', async () => {
    const { pricer: price } = await pricer();

    await expect(price.price(row({ productPromotion: half }))).resolves.toMatchObject({
      effectivePriceCents: 5_000,
      promotionId: 11,
      promotionName: 'Half off',
    });
  });

  it('gives a new product its category sale, so it is born discounted', async () => {
    const { pricer: price } = await pricer();

    await expect(price.price(row({ categoryPromotion: half }))).resolves.toMatchObject({
      effectivePriceCents: 5_000,
      promotionId: 11,
    });
  });

  it('applies the cheaper of the two, which is what a sale promises', async () => {
    const { pricer: price } = await pricer();

    const priced = await price.price(
      row({ productPromotion: tenPercent, categoryPromotion: half }),
    );

    expect(priced).toMatchObject({ effectivePriceCents: 5_000, promotionId: 11 });
  });

  it('carries no promotion field at all when none applies, never an empty one', async () => {
    const { pricer: price } = await pricer();

    const priced = await price.price(row());

    expect(priced).not.toHaveProperty('promotionId');
    expect(priced).not.toHaveProperty('promotionName');
  });

  it('lets a product whose own promotion is defective still take the category sale', async () => {
    const { pricer: price, lines } = await pricer();

    const priced = await price.price(
      row({
        productPromotion: { ...tenPercent, discountType: 'barter' as unknown as 'fixed' },
        categoryPromotion: half,
      }),
    );

    // An unpriceable candidate is absent to the rules rather than fatal: the
    // product is priced and the defect is visible.
    expect(priced).toMatchObject({ effectivePriceCents: 5_000, promotionId: 11 });
    expect(lines.at(-1)).toMatchObject({ level: 40, promotionId: 12 });
  });

  it('falls back to the base price when the only candidate cannot be priced', async () => {
    const { pricer: price } = await pricer();

    const priced = await price.price(row({ productPromotion: { ...half, value: 20_000 } }));

    expect(priced).toMatchObject({ effectivePriceCents: 10_000 });
    expect(priced).not.toHaveProperty('promotionId');
  });

  it('carries the pricing rules version when the row has one, and omits it when not', async () => {
    const { pricer: price } = await pricer();

    await expect(price.price(row())).resolves.toMatchObject({
      pricingRulesVersion: 1_789_238_046,
    });
    await expect(price.price(row({ pricingRulesVersion: null }))).resolves.not.toHaveProperty(
      'pricingRulesVersion',
    );
  });
});
