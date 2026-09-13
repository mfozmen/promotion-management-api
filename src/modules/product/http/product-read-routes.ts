import { Router } from 'express';
import { validate } from '../../../shared/http/request-validator.js';
import { detailParams, type DetailParams } from '../domain/dto/detail-params.js';
import { listQuery, type ListQuery } from '../domain/dto/list-query.js';
import type { FindProductQuery } from '../queries/find-product-query.js';
import type { ListProductsQuery } from '../queries/list-products-query.js';
import type { ProductReadRepository } from '../db/product-read-repository.js';
import { requireReadModel } from './require-read-model.js';

interface Queries {
  readModel: ProductReadRepository;
  find: FindProductQuery;
  list: ListProductsQuery;
}

export function productReadRoutes({ readModel, find, list }: Queries): Router {
  const router = Router();
  router.use(requireReadModel(readModel));

  router.get('/', validate({ query: listQuery }), (req, res, next) => {
    list
      .execute(req.query as unknown as ListQuery)
      .then((page) => {
        res.json(page);
      })
      .catch(next);
  });

  router.get('/:id', validate({ params: detailParams }), (req, res, next) => {
    find
      .execute((req.params as unknown as DetailParams).id)
      .then((product) => {
        res.json(product);
      })
      .catch(next);
  });

  return router;
}
