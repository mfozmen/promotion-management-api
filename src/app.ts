import express, { type Express } from 'express';
import createError from 'http-errors';
import type { Logger } from 'pino';
import { adminRouter } from './modules/admin/http/admin-router.js';
import type { ProductReadRepository } from './modules/storefront/db/product-read-repository.js';
import { FindProductQuery } from './modules/storefront/queries/find-product-query.js';
import { ReadModelReadinessQuery } from './modules/storefront/queries/read-model-readiness-query.js';
import { ListProductsQuery } from './modules/storefront/queries/list-products-query.js';
import { productReadRoutes } from './modules/storefront/http/product-read-routes.js';
import { errorHandler } from './shared/http/error-handler.js';
import { httpLogger } from './shared/http/http-logger.js';

// JSON only: a multipart vendor upload brings its own byte limit (ADR-0009).
const BODY_LIMIT = '100kb';

// Optional for the skeleton's own tests, which build an app without a queue; every
// deployment passes one. Where there is none the admin route is absent rather than
// answering about queues it cannot see.
export function createApp(
  logger: Logger,
  products: ProductReadRepository,
  queueStats?: Parameters<typeof adminRouter>[0],
): Express {
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
      readiness: new ReadModelReadinessQuery(products),
      find: new FindProductQuery(products),
      list: new ListProductsQuery(products),
    }),
  );
  if (queueStats !== undefined) api.use('/admin', adminRouter(queueStats));
  app.use('/api', api);

  app.use((_req, _res, next) => {
    next(createError(404, 'Route not found'));
  });
  app.use(errorHandler);

  return app;
}
