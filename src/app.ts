import express, { type Express } from 'express';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { productReadRoutes } from './modules/product/product.read.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { httpLogger, logger as rootLogger } from './shared/logger.js';

// JSON only: a multipart vendor upload brings its own byte limit (ADR-0008).
const BODY_LIMIT = '100kb';

export interface AppDeps {
  logger?: Logger;
  /** The storefront's only store. Omitted, the product routes are not mounted,
   *  so a process without Redis serves the liveness probe and nothing that
   *  would need it (ADR-0006). */
  redis?: Redis;
}

export function createApp({ logger = rootLogger, redis }: AppDeps = {}): Express {
  const app = express();
  // Free to remove, and every response including a 404 carries it otherwise.
  app.disable('x-powered-by');
  app.use(httpLogger(logger));
  app.use(express.json({ limit: BODY_LIMIT }));

  const api = express.Router();
  api.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  if (redis !== undefined) {
    api.use('/products', productReadRoutes(redis));
  }
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
