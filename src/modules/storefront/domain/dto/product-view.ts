import { z } from 'zod';
import { storedProduct } from './stored-product.js';

/** The shape a storefront client reads: prices and the promotion that made
 *  them, with the read model's own bookkeeping left behind. */
export const productView = storedProduct.transform(
  ({ promotionId, promotionName, ...product }) => ({
    ...product,
    promotion:
      promotionId === undefined || promotionName === undefined
        ? null
        : { id: promotionId, name: promotionName },
  }),
);

export type ProductView = z.infer<typeof productView>;
