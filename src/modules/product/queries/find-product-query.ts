import createError from 'http-errors';
import type { ProductReadModel } from '../db/product-read-model.js';
import { toProductView } from '../domain/to-product-view.js';

/** One product for a shopper who has its id. The miss is this query's 404, so
 *  the route decides nothing (ADR-0008). */
export class FindProductQuery {
  constructor(private readonly readModel: ProductReadModel) {}

  async execute(id: number) {
    const hash = await this.readModel.hash(id);

    if (Object.keys(hash).length === 0) throw createError(404, 'Product not found');

    return toProductView(hash);
  }
}
