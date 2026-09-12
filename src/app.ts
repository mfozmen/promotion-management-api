import express, { type Express } from 'express';
import type { Logger } from 'pino';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { httpLogger, logger as rootLogger } from './shared/logger.js';

// JSON routes carry a single entity. This guards them only: a multipart vendor
// upload is not parsed here and brings its own byte limit.
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
