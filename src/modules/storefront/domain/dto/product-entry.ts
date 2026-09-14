export interface ProductEntry {
  id: number;
  sku: string;
  name: string;
  category: string;
  basePriceCents: number;
  effectivePriceCents: number;
  stockQuantity: number;
  promotionId?: number;
  promotionName?: string;
  pricingRulesVersion?: number;
}
