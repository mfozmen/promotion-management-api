import { randomInt } from 'node:crypto';
import type { ErrorRequestHandler } from 'express';
import { CLIENT_ERRORS } from './client-errors.js';
import type { ErrorCode } from './error-code.js';
import { MAX_DETAILS } from './max-details.js';
import { MAX_MESSAGE } from '../max-message.js';
import { OTHER_CLIENT_ERROR } from './other-client-error.js';
import type { ErrorMapping } from './error-mapping.js';
import { HttpError } from './http-error.js';
import { logger } from '../logger.js';
import { serializeError } from '../serialize-error.js';

/** A band rather than a number: a flat hint has every client that met the
 *  outage returning in the same second, so the read model's first healthy
 *  moment takes the whole backlog at once. */
const RETRY_AFTER_MIN = 5;
const RETRY_AFTER_SPREAD = 6;
// `crypto.randomInt`, not `Math.random`: the jitter is fine either way, but a
// non-cryptographic generator on a response header is a security hotspot.
const retryAfter = (): string =>
  String(randomInt(RETRY_AFTER_MIN, RETRY_AFTER_MIN + RETRY_AFTER_SPREAD));

/** The two codes whose whole meaning is "come back later". An array rather
 *  than a `ReadonlySet`: freezing a Set does not stop `.add`, so the readonly
 *  type would be the only guard, and it is erased at build time. */
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

/** Every error marked the http-errors way keeps its status, not an enumerated few (ADR-0009). */
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
      res.set('Retry-After', retryAfter());
    }
    if (known.details !== undefined) {
      body.error.details = known.details.slice(0, MAX_DETAILS);
    }
    res.status(known.status).json(body);

    return;
  }

  log.error({ error: serializeError(err) }, 'unhandled error');
  res
    .status(SERVER_FAULT.status)
    .json({ error: { code: SERVER_FAULT.code, message: SERVER_FAULT.message } });
};
