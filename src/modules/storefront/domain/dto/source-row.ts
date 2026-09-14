import type { PromotionCandidate } from './promotion-candidate.js';

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
