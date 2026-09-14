/** A product row as PostgreSQL holds it, which is what every recompute starts
 *  from; the effective price is decided from it rather than read. */
export interface SourceRow {
  id: number;
  sku: string;
  name: string;
  category: string;
  basePriceCents: number;
  stockQuantity: number;
  pricingRulesVersion: number | null;
}
