import { ProductReadModel } from '../db/product-read-model.js';
import type { ListQuery } from '../domain/dto/list-query.js';
import { toProductView } from '../domain/to-product-view.js';

/** A page of a category, ordered by the price a shopper would pay. Three round
 *  trips whatever the page size: the page, the total, one pipeline. */
export class ListProductsQuery {
  constructor(private readonly readModel: ProductReadModel) {}

  async execute({ category, order, page, pageSize }: ListQuery) {
    const key =
      category === undefined
        ? ProductReadModel.ALL_PRODUCTS
        : ProductReadModel.categoryKey(category);
    const offset = (page - 1) * pageSize;

    const [ids, total] = await Promise.all([
      this.readModel.page(key, order, offset, pageSize),
      this.readModel.count(key),
    ]);
    const hashes = await this.readModel.hashes(ids);

    // A member whose entry is gone is dropped rather than taking the page with
    // it (ADR-0006).
    const present = hashes.filter((hash) => Object.keys(hash).length > 0);

    return { items: present.map(toProductView), page, pageSize, total };
  }
}
