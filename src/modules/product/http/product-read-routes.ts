import { Router } from 'express';
import { validate } from '../../../shared/http/request-validator.js';
import { findProductInput, type FindProductInput } from '../domain/dto/find-product-input.js';
import { listProductsInput, type ListProductsInput } from '../domain/dto/list-products-input.js';
import type { FindProductQuery } from '../queries/find-product-query.js';
import type { ListProductsQuery } from '../queries/list-products-query.js';
import type { ProductReadRepository } from '../db/product-read-repository.js';
import { requireReadModel } from './require-read-model.js';

interface Queries {
  products: ProductReadRepository;
  find: FindProductQuery;
  list: ListProductsQuery;
}

export function productReadRoutes({ products, find, list }: Queries): Router {
  const router = Router();
  router.use(requireReadModel(products));

  router.get('/', validate({ query: listProductsInput }), (req, res, next) => {
    list
      .execute(req.query as unknown as ListProductsInput)
      .then((page) => {
        res.json(page);
      })
      .catch(next);
  });

  router.get('/:id', validate({ params: findProductInput }), (req, res, next) => {
    find
      .execute((req.params as unknown as FindProductInput).id)
      .then((product) => {
        res.json(product);
      })
      .catch(next);
  });

  return router;
}
