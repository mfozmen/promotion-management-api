import express, { type Express } from 'express';
import type { Logger } from 'pino';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { productRoutes } from './modules/product/product-routes.js';
import type { Db } from './shared/db/client.js';
import type { Enqueue } from './shared/enqueue.js';
import { httpLogger, logger as rootLogger } from './shared/logger.js';

// JSON only: a multipart vendor upload brings its own byte limit (ADR-0008).
const BODY_LIMIT = '100kb';

/**
 * What the app needs from outside itself. `db` and `enqueue` are optional
 * because the health probe needs neither: a process that cannot reach
 * PostgreSQL still has to answer its liveness check, and the routes that do
 * need them are simply not mounted without them.
 */
export interface AppDependencies {
  logger?: Logger;
  db?: Db;
  enqueue?: Enqueue;
}

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
