import createError from 'http-errors';
import type { Logger } from 'pino';
import type { ProductRepository } from '../db/product-repository.js';
import type { CreateProduct } from '../domain/dto/create-product-input.js';
import type { Product } from '../domain/dto/product.js';

/** What this command needs of the queue; the queue knows nothing of products. */
type ProductQueue = {
  publish(name: 'product.upserted', payload: { productIds: number[] }): Promise<unknown>;
};

export class CreateProductCommand {
  constructor(
    private readonly products: ProductRepository,
    private readonly queue: ProductQueue,
    private readonly logger: Logger,
  ) {}

  async execute(input: CreateProduct): Promise<Product> {
    const outcome = await this.products.insert(input);

    if (!outcome.ok) throw createError(409, 'A product with this SKU already exists');

    // After the insert has committed, never inside it: an event carrying an id a
    // rollback would take away sends the worker to recompute a product that does
    // not exist. The failure is not the caller's — the row is written, and losing
    // the write to save the event would be the worse trade.
    await this.queue
      .publish('product.upserted', { productIds: [outcome.product.id] })
      .catch((error: unknown) => {
        this.logger.error(
          { productId: outcome.product.id, err: error },
          'product.upserted could not be enqueued; this product stays out of the read model until it changes again',
        );
      });

    return outcome.product;
  }
}
