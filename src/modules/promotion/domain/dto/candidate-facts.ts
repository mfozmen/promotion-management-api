export interface CandidateFacts {
  category: string;
  stockQuantity: number;
  basePriceCents: number;
  productPriceCents: number | null;
  categoryPriceCents: number | null;
}
