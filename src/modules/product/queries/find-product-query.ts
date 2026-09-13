import createError from 'http-errors';
import type { ProductReadModel } from '../db/product-read-model.js';
import { toProductView } from '../domain/to-product-view.js';

export class FindProductQuery {
  constructor(private readonly readModel: ProductReadModel) {}

  async execute(id: number) {
    const hash = await this.readModel.hash(id);

    if (Object.keys(hash).length === 0) throw createError(404, 'Product not found');

    return toProductView(hash);
  }
}
