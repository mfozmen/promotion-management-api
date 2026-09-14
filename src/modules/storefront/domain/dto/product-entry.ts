/** A product as the read-model writer takes it: whole, never a delta, with the
 *  promotion pair present together or absent together (ADR-0006). */
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
