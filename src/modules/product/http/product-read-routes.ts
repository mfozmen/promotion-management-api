import { Router } from 'express';
import type { Redis } from 'ioredis';
import { validate } from '../../../shared/http/request-validator.js';
import { HttpError } from '../../../shared/http/http-error.js';
import { findProduct } from '../db/find-product.js';
import { listProducts } from '../db/list-products.js';
import { detailParams, type DetailParams } from '../domain/dto/detail-params.js';
import { listQuery, type ListQuery } from '../domain/dto/list-query.js';
import { requireReadModel } from './require-read-model.js';

export function productReadRoutes(redis: Redis): Router {
  const router = Router();
  router.use(requireReadModel(redis));

  router.get('/', validate({ query: listQuery }), (req, res, next) => {
    const { category, order, page, pageSize } = req.query as unknown as ListQuery;

    listProducts(redis, { category, order, page, pageSize })
      .then(({ items, total }) => {
        res.json({ items, page, pageSize, total });
      })
      .catch(next);
  });

  router.get('/:id', validate({ params: detailParams }), (req, res, next) => {
    const { id } = req.params as unknown as DetailParams;

    findProduct(redis, id)
      .then((product) => {
        if (product === undefined) {
          throw new HttpError('NOT_FOUND', 'Product not found');
        }
        res.json(product);
      })
      .catch(next);
  });

  return router;
}
