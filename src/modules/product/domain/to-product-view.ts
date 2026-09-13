import { storedProduct } from './stored-product.js';

/** The shape a storefront client reads: prices and the promotion that made
 *  them, with the read model's own bookkeeping left behind. */
export function toProductView(hash: Record<string, string>) {
  const { promotionId, promotionName, ...product } = storedProduct.parse(hash);

  return {
    ...product,
    promotion: promotionId === undefined ? null : { id: promotionId, name: promotionName },
  };
}
