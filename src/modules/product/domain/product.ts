/**
 * A product as the API returns it.
 *
 * Deliberately not the database row: `ingestJobId`, `ingestSourceOffset` and
 * `pricingRulesVersion` are how the row was written, which is nobody's business
 * outside ingestion, and returning the row wholesale is how they would leak the
 * first time a column is added.
 */
export interface Product {
  id: number;
  sku: string;
  name: string;
  category: string;
  basePriceCents: number;
  stockQuantity: number;
}
