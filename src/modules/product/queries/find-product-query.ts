import createError from 'http-errors';
import type { ProductReadRepository } from '../db/product-read-repository.js';
import { toProductView } from '../domain/to-product-view.js';

export class FindProductQuery {
  constructor(private readonly products: ProductReadRepository) {}

  async execute(id: number) {
    const hash = await this.products.find(id);

    if (Object.keys(hash).length === 0) throw createError(404, 'Product not found');

    return toProductView(hash);
  }
}
