import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MAX_DETAILS, MAX_MESSAGE } from '../shared/error-bounds.js';
import type { ErrorMapping } from './error-mapping.js';
import {
  CLIENT_ERRORS,
  HttpError,
  OTHER_CLIENT_ERROR,
  type ErrorCode,
} from '../shared/http-error.js';
import { logger, serializeError } from '../shared/logger.js';

/** A 4xx message crosses verbatim, so the bound belongs here rather than in
 *  every handler that writes one. */
/** The two codes whose whole meaning is "come back later". Without a number a
 *  client retries as fast as it can, which amplifies the outage it met. */
const RETRY_AFTER_SECONDS = '5';
// An array rather than a `ReadonlySet`: freezing a Set does not stop `.add`,
// so the readonly type would be the only guard, and it is erased at build time.
const RETRIABLE: readonly ErrorCode[] = Object.freeze(['BACKPRESSURE', 'READ_MODEL_NOT_READY']);

// Frozen: its message is the body of every 500.
const SERVER_FAULT = Object.freeze({
  status: 500,
  code: 'INTERNAL',
  message: 'Internal server error',
} as const);

/** Public wording for a 5xx. A code without an entry says nothing to a client. */
const SERVER_MESSAGES: Readonly<Partial<Record<ErrorCode, string>>> = Object.freeze({
  READ_MODEL_NOT_READY: 'The read model is not ready yet; retry shortly',
});
/* Strings are immutable, so freezing the object is the whole control here. */

/**
 * Express 5 throws a `RangeError` for a status outside [100, 999], so an
 * unbounded one turns the error handler itself into the failure.
 */
const isClientStatus = (status: unknown): status is number =>
  typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 499;

/** Every error marked the http-errors way keeps its status, not an enumerated few (ADR-0008). */
function clientError(err: unknown): ErrorMapping | undefined {
  const { status, expose } = err as { status?: unknown; expose?: unknown };
  if (expose !== true || !isClientStatus(status)) {
    return undefined;
  }

  return { status, ...(CLIENT_ERRORS[status] ?? OTHER_CLIENT_ERROR) };
}

/**
 * Being our own type is not the same as being safe: a 5xx message is written
 * for an operator, so it crosses only where we wrote public words for its code.
 * The status needs no guarding — it is derived from the code.
 */
function raisedError(err: HttpError): ErrorMapping {
  if (err.status < 500) {
    return err;
  }
  const message = SERVER_MESSAGES[err.code];

  return message ? { status: err.status, code: err.code, message } : SERVER_FAULT;
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  // The path is not echoed back. Not because it is untrusted — so is a rejected
  // key, and that one is returned — but because there is nothing to fix by
  // seeing it again (REVIEW.md 8.3b).
  next(new HttpError('NOT_FOUND', 'Route not found'));
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

  const known: ErrorMapping | undefined =
    err instanceof HttpError ? raisedError(err) : clientError(err);

  if (known) {
    if (isClientStatus(known.status)) {
      log.warn({ code: known.code, status: known.status }, 'request rejected');
    } else {
      // The code and status the client read: `serializeError` reports the
      // cause's code, so without these the line names the driver's failure and
      // nothing joins it to the response.
      log.error(
        { code: known.code, status: known.status, error: serializeError(err) },
        'server fault raised by a handler',
      );
    }
    const body: { error: Omit<ErrorMapping, 'status'> } = {
      error: { code: known.code, message: known.message.slice(0, MAX_MESSAGE) },
    };
    if (RETRIABLE.includes(known.code)) {
      res.set('Retry-After', RETRY_AFTER_SECONDS);
    }
    if (known.details !== undefined) {
      // Bounded at the envelope every producer crosses, not at one of them: a
      // 100kb body of array items is thousands of zod issues, and an
      // unauthenticated request must not amplify into the response.
      // ponytail: truncated, not counted — the client fixes what it is shown,
      // and several round trips on a large batch is the accepted cost. An object
      // passes whole: the only producer of a list today is the validator.
      body.error.details = Array.isArray(known.details)
        ? known.details.slice(0, MAX_DETAILS)
        : known.details;
    }
    res.status(known.status).json(body);

    return;
  }

  log.error({ error: serializeError(err) }, 'unhandled error');
  res
    .status(SERVER_FAULT.status)
    .json({ error: { code: SERVER_FAULT.code, message: SERVER_FAULT.message } });
};
