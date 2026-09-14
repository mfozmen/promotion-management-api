/** What a promotion rule may read. Each candidate arrives already priced, so a
 *  rule compares outcomes rather than recomputing them; null is no candidate at
 *  that level. `category` and `stockQuantity` are as fresh as the product's last
 *  event and no fresher — nothing watches stock. */
export interface CandidateFacts {
  category: string;
  stockQuantity: number;
  basePriceCents: number;
  productPriceCents: number | null;
  categoryPriceCents: number | null;
}
