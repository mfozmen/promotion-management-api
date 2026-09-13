import createError from 'http-errors';
import type { ProductReadRepository } from '../db/product-read-repository.js';
import { ReadModelUnavailableError } from '../db/read-model-unavailable-error.js';
import { productView } from '../domain/dto/product-view.js';

export class FindProductQuery {
  constructor(private readonly products: ProductReadRepository) {}

  async execute(id: number) {
    const hash = await this.products.find(id);
    if (hash !== undefined) return productView.parse(hash);

    // A product the index still lists has an entry a rebuild has not rewritten
    // yet, and a 404 for it is cached by every crawler and CDN (ADR-0006). One
    // extra command, on the miss path only.
    if (await this.products.isListed(id)) {
      throw new ReadModelUnavailableError('That product is being rebuilt');
    }

    throw createError(404, 'Product not found');
  }
}
