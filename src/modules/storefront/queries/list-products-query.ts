import type { Logger } from 'pino';
import { ProductReadRepository } from '../db/product-read-repository.js';
import type { ListProductsInput } from '../domain/dto/list-products-input.js';
import { productView } from '../domain/dto/product-view.js';

/** A page of a category, ordered by the price a shopper would pay. Three round
 *  trips whatever the page size: the page, the total, one pipeline. */
export class ListProductsQuery {
  constructor(
    private readonly products: ProductReadRepository,
    private readonly logger: Logger,
  ) {}

  async execute({ category, order, page, pageSize }: ListProductsInput) {
    const offset = (page - 1) * pageSize;

    const [ids, total] = await Promise.all([
      this.products.page({ category, order, offset, size: pageSize }),
      this.products.count(category),
    ]);
    const hashes = await this.products.findAll(ids);

    // A member whose entry is gone is dropped rather than taking the page with
    // it (ADR-0006). A silent drop is a short page and a `total` that does not
    // match it, which reads as a paging bug; this names the ids instead. There
    // is no metrics backend to count into yet, so the count is a log line.
    const dropped = ids.filter((_, index) => hashes[index] === undefined);

    if (dropped.length > 0)
      this.logger.warn(
        { productIds: dropped, category },
        'listing dropped members whose entry is gone; the read model is behind the index',
      );

    return {
      items: hashes.filter((hash) => hash !== undefined).map((hash) => productView.parse(hash)),
      page,
      pageSize,
      total,
    };
  }
}
