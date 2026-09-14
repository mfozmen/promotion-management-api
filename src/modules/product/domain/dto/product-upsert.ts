/** One priced row, ready to store: the vendor's facts plus where they came from. */
export interface ProductUpsert {
  sku: string;
  name: string;
  category: string;
  basePriceCents: number;
  stockQuantity: number;
  pricingRulesVersion: number;
  ingestJobId: number;
  ingestSourceOffset: number;
}
