import type { RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import { HttpError } from '../../../shared/http/http-error.js';
import { READY_KEY } from '../db/read-model-keys.js';

/** The read model is the only store these routes may touch, so an unbuilt one
 *  is a 503 rather than a fallback query (ADR-0006). */
export const requireReadModel =
  (redis: Redis): RequestHandler =>
  (_req, _res, next) => {
    redis
      .exists(READY_KEY)
      .then((ready) => {
        next(
          ready === 1
            ? undefined
            : new HttpError('READ_MODEL_NOT_READY', 'The read model is still being built'),
        );
      })
      .catch(next);
  };
