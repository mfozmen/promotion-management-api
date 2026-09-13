import express, { type Express } from 'express';
import type { AppDependencies } from './app-dependencies.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { productRoutes } from './modules/product/http/product-routes.js';
import { httpLogger, logger as rootLogger } from './shared/logger.js';

// JSON only: a multipart vendor upload brings its own byte limit (ADR-0008).
const BODY_LIMIT = '100kb';

export function createApp({ logger = rootLogger, db, enqueue }: AppDependencies = {}): Express {
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
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
