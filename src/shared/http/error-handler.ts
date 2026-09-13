import type { ErrorRequestHandler } from 'express';
import createError from 'http-errors';
import { MAX_DETAIL_MESSAGE } from './max-detail-message.js';
import { MAX_DETAILS } from './max-details.js';
import { MAX_MESSAGE } from '../max-message.js';
import type { ValidationDetail } from './validation-detail.js';
import { logger } from '../logger.js';
import { serializeError } from '../serialize-error.js';

const INTERNAL_MESSAGE = 'Internal server error';

/** `details` is the validator's own property on the error, so it is checked rather than trusted. */
const detailsOf = (err: createError.HttpError): readonly ValidationDetail[] | undefined => {
  const found: unknown = (err as { details?: unknown }).details;

  return Array.isArray(found) ? (found as readonly ValidationDetail[]) : undefined;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express recognises an error handler by its arity
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Mountable without httpLogger: throwing here would drop the request into
  // Express's final handler, which prints the raw stack to stderr.
  const log = req.log ?? logger;

  if (res.headersSent) {
    // No envelope fits over bytes already sent, and handing the error on would
    // reach that same final handler. A destroyed socket truncates instead.
    log.error({ error: serializeError(err) }, 'unhandled error after the response started');
    res.destroy();

    return;
  }

  if (!createError.isHttpError(err)) {
    log.error({ error: serializeError(err) }, 'unhandled error');
    res.status(500).json({ error: { message: INTERNAL_MESSAGE } });

    return;
  }

  // `expose` is the library's answer to what a client may read — false for a 5xx
  // unless the raiser said otherwise — so a message written for an operator
  // cannot reach a caller by being forgotten about.
  const message = err.expose ? err.message.slice(0, MAX_MESSAGE) : INTERNAL_MESSAGE;
  const headers = err.headers ?? {};
  // A retriable 5xx is an operating condition, not a fault: at `error` a rebuild
  // writes one alertable line per request and the real 500s sit inside that noise.
  const retriable = headers['retry-after'] !== undefined;

  if (err.status < 500 || retriable) {
    log.warn({ status: err.status }, 'request rejected');
  } else {
    log.error(
      { status: err.status, error: serializeError(err) },
      'server fault raised by a handler',
    );
  }

  res.set(headers);

  const body: { error: { message: string; details?: readonly ValidationDetail[] } } = {
    error: { message },
  };
  // Only when the message is exposed: masking the prose and returning the details
  // beside it leaks by the other field. A masked 5xx says one sentence and nothing else.
  const details = err.expose ? detailsOf(err) : undefined;
  if (details !== undefined) {
    body.error.details = details
      .slice(0, MAX_DETAILS)
      .map(({ path, message: text }) => ({ path, message: text.slice(0, MAX_DETAIL_MESSAGE) }));
  }

  res.status(err.status).json(body);
};
