import express, { type Express } from 'express';
import type { Logger } from 'pino';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { httpLogger, logger as rootLogger } from './shared/logger.js';

/**
 * The body cap is small on purpose: the JSON routes carry a single entity, and
 * the smallest configured container is 256 MB (REVIEW.md §8.6). Vendor files
 * arrive as a multipart stream, not as a JSON body.
 */
const BODY_LIMIT = '100kb';

export function createApp(logger: Logger = rootLogger): Express {
  const app = express();
  app.use(httpLogger(logger));
  app.use(express.json({ limit: BODY_LIMIT }));

  const api = express.Router();
  api.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
