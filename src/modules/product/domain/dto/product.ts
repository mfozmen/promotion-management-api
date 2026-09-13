/** The shape a create answers with; the read model's view is the storefront's. */
export interface Product {
  id: number;
  sku: string;
  name: string;
  category: string;
  basePriceCents: number;
  stockQuantity: number;
}
