import type { RequestHandler } from 'express';
import type { ReadModelReadinessQuery } from '../queries/read-model-readiness-query.js';

export const requireReadModel =
  (readiness: ReadModelReadinessQuery): RequestHandler =>
  (_req, _res, next) => {
    readiness
      .execute()
      .then(() => {
        next();
      })
      .catch((error: unknown) => {
        next(error);
      });
  };
