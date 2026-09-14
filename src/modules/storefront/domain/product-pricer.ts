import type { Logger } from 'pino';
import type { EffectivePriceCalculator } from '../../promotion/domain/effective-price-calculator.js';
import type { PromotionResolver } from '../../promotion/domain/promotion-resolver.js';
import type { CandidateLevel } from '../../promotion/domain/dto/candidate-level.js';
import type { ProductEntry } from './dto/product-entry.js';
import type { PromotionCandidate } from './dto/promotion-candidate.js';
import type { SourceRow } from './dto/source-row.js';

export class ProductPricer {
  constructor(
    private readonly resolver: PromotionResolver,
    private readonly calculator: EffectivePriceCalculator,
    private readonly logger: Logger,
  ) {}

  async price(row: SourceRow): Promise<ProductEntry> {
    const product = this.priced(row, row.productPromotion);
    const category = this.priced(row, row.categoryPromotion);

    const level = await this.resolver.select({
      category: row.category,
      stockQuantity: row.stockQuantity,
      basePriceCents: row.basePriceCents,
      productPriceCents: product?.effectivePriceCents ?? null,
      categoryPriceCents: category?.effectivePriceCents ?? null,
    });

    const applied = ProductPricer.at(level, product, category);

    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      category: row.category,
      basePriceCents: row.basePriceCents,
      effectivePriceCents: applied?.effectivePriceCents ?? row.basePriceCents,
      stockQuantity: row.stockQuantity,
      // Both or neither: Redis has no null and the reader refuses half a pair.
      ...(applied === undefined
        ? {}
        : { promotionId: applied.promotion.id, promotionName: applied.promotion.name }),
      ...(row.pricingRulesVersion === null ? {} : { pricingRulesVersion: row.pricingRulesVersion }),
    };
  }

  private static at<T>(
    level: CandidateLevel | undefined,
    product: T | undefined,
    category: T | undefined,
  ): T | undefined {
    if (level === 'product') return product;
    if (level === 'category') return category;

    return undefined;
  }

  /** An unpriceable candidate is absent to the rules rather than fatal, so a
   *  product whose own promotion is defective still takes its category's sale. */
  private priced(
    row: SourceRow,
    promotion: PromotionCandidate | null,
  ): { promotion: PromotionCandidate; effectivePriceCents: number } | undefined {
    if (promotion === null) return undefined;

    const outcome = this.calculator.calculate(row.basePriceCents, promotion);

    if (!outcome.ok) {
      this.logger.warn(
        { productId: row.id, promotionId: promotion.id, reason: outcome.reason },
        'promotion could not be priced and was not considered',
      );
      return undefined;
    }

    return { promotion, effectivePriceCents: outcome.effectivePriceCents };
  }
}
