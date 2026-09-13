import type { ProductReadRepository } from '../db/product-read-repository.js';
import { ReadModelUnavailableError } from '../db/read-model-unavailable-error.js';

export class ReadModelReadinessQuery {
  constructor(private readonly products: ProductReadRepository) {}

  /** Raises rather than answering: no route has a second thing to do with it. */
  async execute(): Promise<void> {
    if (!(await this.products.isReady())) {
      throw new ReadModelUnavailableError('The read model is still being built');
    }
  }
}
