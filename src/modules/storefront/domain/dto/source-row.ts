import type { PromotionCandidate } from './promotion-candidate.js';

/** A product row as PostgreSQL holds it, with the promotions that could apply to
 *  it: its own and its category's, each null when there is none running. Which
 *  one is applied is the resolver's to decide. */
export interface SourceRow {
  id: number;
  sku: string;
  name: string;
  category: string;
  basePriceCents: number;
  stockQuantity: number;
  pricingRulesVersion: number | null;
  productPromotion: PromotionCandidate | null;
  categoryPromotion: PromotionCandidate | null;
}
