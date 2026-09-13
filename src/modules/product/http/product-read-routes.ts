import { Router } from 'express';
import { validate } from '../../../shared/http/request-validator.js';
import createError from 'http-errors';
import { ProductReadModel } from '../db/product-read-model.js';
import { detailParams, type DetailParams } from '../domain/dto/detail-params.js';
import { listQuery, type ListQuery } from '../domain/dto/list-query.js';
import { requireReadModel } from './require-read-model.js';

export function productReadRoutes(readModel: ProductReadModel): Router {
  const router = Router();
  router.use(requireReadModel(readModel));

  router.get('/', validate({ query: listQuery }), (req, res, next) => {
    const { category, order, page, pageSize } = req.query as unknown as ListQuery;

    readModel
      .list({ category, order, page, pageSize })
      .then(({ items, total }) => {
        res.json({ items, page, pageSize, total });
      })
      .catch(next);
  });

  router.get('/:id', validate({ params: detailParams }), (req, res, next) => {
    const { id } = req.params as unknown as DetailParams;

    readModel
      .find(id)
      .then((product) => {
        if (product === undefined) {
          throw createError(404, 'Product not found');
        }
        res.json(product);
      })
      .catch(next);
  });

  return router;
}
