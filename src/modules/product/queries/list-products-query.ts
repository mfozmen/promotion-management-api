import { ProductReadRepository } from '../db/product-read-repository.js';
import type { ListQuery } from '../domain/dto/list-query.js';
import { productView } from '../domain/dto/product-view.js';

/** A page of a category, ordered by the price a shopper would pay. Three round
 *  trips whatever the page size: the page, the total, one pipeline. */
export class ListProductsQuery {
  constructor(private readonly products: ProductReadRepository) {}

  async execute({ category, order, page, pageSize }: ListQuery) {
    const offset = (page - 1) * pageSize;

    const [ids, total] = await Promise.all([
      this.products.page({ category, order, offset, size: pageSize }),
      this.products.count(category),
    ]);
    const hashes = await this.products.findAll(ids);

    // A member whose entry is gone is dropped rather than taking the page with
    // it (ADR-0006).
    const present = hashes.filter((hash) => Object.keys(hash).length > 0);

    return { items: present.map((hash) => productView.parse(hash)), page, pageSize, total };
  }
}
