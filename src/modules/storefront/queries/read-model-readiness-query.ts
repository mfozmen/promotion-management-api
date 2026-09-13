import type { ProductReadRepository } from '../db/product-read-repository.js';
import { ReadModelUnavailableError } from '../db/read-model-unavailable-error.js';

export class ReadModelReadinessQuery {
  constructor(private readonly products: ProductReadRepository) {}

  /** Raises rather than answering: an unbuilt read model is a 503 and no route
   *  has a second thing to do with the answer (ADR-0006). */
  async execute(): Promise<void> {
    if (!(await this.products.isReady())) {
      throw new ReadModelUnavailableError('The read model is still being built');
    }
  }
}
