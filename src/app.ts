import express, { type Express } from 'express';
import type { AppDependencies } from './app-dependencies.js';
import { productRoutes } from './modules/catalog/http/product-routes.js';
import { promotionRoutes } from './modules/promotion/http/promotion-routes.js';
import { errorHandler } from './shared/http/error-handler.js';
import { notFoundHandler } from './shared/http/not-found-handler.js';
import { logger as rootLogger } from './shared/logger.js';
import { httpLogger } from './shared/http/http-logger.js';

// JSON only: a multipart vendor upload brings its own byte limit (ADR-0009).
const BODY_LIMIT = '100kb';

export function createApp({
  logger = rootLogger,
  db,
  enqueue,
  boundaries,
}: AppDependencies = {}): Express {
  const app = express();
  // Free to remove, and every response including a 404 carries it otherwise.
  app.disable('x-powered-by');
  app.use(httpLogger(logger));
  app.use(express.json({ limit: BODY_LIMIT }));

  const api = express.Router();
  api.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  if (db && enqueue) api.use('/products', productRoutes(db, enqueue));
  if (db && enqueue && boundaries) api.use('/promotions', promotionRoutes(db, enqueue, boundaries));
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
