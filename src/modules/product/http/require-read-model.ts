import type { RequestHandler } from 'express';
import { ProductReadRepository } from '../db/product-read-repository.js';
import { ReadModelUnavailableError } from '../db/read-model-unavailable-error.js';

/** The read model is the only store these routes may touch, so an unbuilt one
 *  is a 503 rather than a fallback query (ADR-0006). */
export const requireReadModel =
  (products: ProductReadRepository): RequestHandler =>
  (_req, _res, next) => {
    products
      .isReady()
      .then((ready) => {
        next(
          ready ? undefined : new ReadModelUnavailableError('The read model is still being built'),
        );
      })
      .catch((error: unknown) => {
        next(error);
      });
  };
