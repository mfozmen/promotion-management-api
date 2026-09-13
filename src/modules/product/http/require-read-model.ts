import type { RequestHandler } from 'express';
import { ProductReadRepository } from '../db/product-read-repository.js';
import { ReadModelUnavailable } from '../db/read-model-unavailable.js';

/** The read model is the only store these routes may touch, so an unbuilt one
 *  is a 503 rather than a fallback query (ADR-0006). */
export const requireReadModel =
  (readModel: ProductReadRepository): RequestHandler =>
  (_req, _res, next) => {
    readModel
      .isReady()
      .then((ready) => {
        next(ready ? undefined : new ReadModelUnavailable('The read model is still being built'));
      })
      .catch((error: unknown) => {
        next(error);
      });
  };
