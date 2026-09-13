import createError from 'http-errors';
import type { ProductReadRepository } from '../db/product-read-repository.js';
import { productView } from '../domain/dto/product-view.js';

export class FindProductQuery {
  constructor(private readonly products: ProductReadRepository) {}

  async execute(id: number) {
    const hash = await this.products.find(id);

    if (hash === undefined) throw createError(404, 'Product not found');

    return productView.parse(hash);
  }
}
