import { Router } from 'express';
import { validate } from '../../../shared/http/request-validator.js';
import { findProductInput, type FindProductInput } from '../domain/dto/find-product-input.js';
import { listProductsInput, type ListProductsInput } from '../domain/dto/list-products-input.js';
import type { FindProductQuery } from '../queries/find-product-query.js';
import type { ListProductsQuery } from '../queries/list-products-query.js';
import type { ReadModelReadinessQuery } from '../queries/read-model-readiness-query.js';
import { requireReadModel } from './require-read-model.js';

interface Queries {
  readiness: ReadModelReadinessQuery;
  find: FindProductQuery;
  list: ListProductsQuery;
}

export function productReadRoutes({ readiness, find, list }: Queries): Router {
  const router = Router();
  // After `validate`, not in front of it: a request the validator refuses for
  // free would otherwise spend a Redis round trip and a connection slot first.
  const ready = requireReadModel(readiness);

  router.get('/', validate({ query: listProductsInput }), ready, (req, res, next) => {
    list
      .execute(req.query as unknown as ListProductsInput)
      .then((page) => {
        res.json(page);
      })
      .catch(next);
  });

  router.get('/:id', validate({ params: findProductInput }), ready, (req, res, next) => {
    find
      .execute((req.params as unknown as FindProductInput).id)
      .then((product) => {
        res.json(product);
      })
      .catch(next);
  });

  return router;
}
