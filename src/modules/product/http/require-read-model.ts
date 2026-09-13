import type { RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import { HttpError } from '../../../shared/http/http-error.js';
import { READY_KEY } from '../db/ready-key.js';
import { replyFailure } from '../db/reply-failure.js';

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
      .catch((error: unknown) => {
        // The same classifier the four command sites use: the gate runs first
        // on every request, so an exemption here is the rule holding nowhere
        // that matters.
        next(replyFailure(error));
      });
  };
