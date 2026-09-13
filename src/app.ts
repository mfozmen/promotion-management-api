import express, { type Express } from 'express';
import createError from 'http-errors';
import type { Logger } from 'pino';
import type { ProductReadModel } from './modules/product/db/product-read-model.js';
import { FindProductQuery } from './modules/product/queries/find-product-query.js';
import { ListProductsQuery } from './modules/product/queries/list-products-query.js';
import { productReadRoutes } from './modules/product/http/product-read-routes.js';
import { errorHandler } from './shared/http/error-handler.js';
import { httpLogger } from './shared/http/http-logger.js';

// JSON only: a multipart vendor upload brings its own byte limit (ADR-0009).
const BODY_LIMIT = '100kb';

/** The read model is required: the storefront routes are the application. */
export function createApp(logger: Logger, readModel: ProductReadModel): Express {
  const app = express();
  // Free to remove, and every response including a 404 carries it otherwise.
  app.disable('x-powered-by');
  app.use(httpLogger(logger));
  app.use(express.json({ limit: BODY_LIMIT }));

  const api = express.Router();
  api.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  api.use(
    '/products',
    productReadRoutes({
      readModel,
      find: new FindProductQuery(readModel),
      list: new ListProductsQuery(readModel),
    }),
  );
  app.use('/api', api);

  app.use((_req, _res, next) => {
    next(createError(404, 'Route not found'));
  });
  app.use(errorHandler);

  return app;
}
