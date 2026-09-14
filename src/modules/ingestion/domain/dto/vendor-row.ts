/** One vendor row, after parsing and before the pricing rules see it. */
export interface VendorRow {
  sku: string;
  name: string;
  category: string;
  vendorPriceCents: number;
  stockQuantity: number;
}
