import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError, type ErrorCode } from '../shared/http-error.js';
import { logger, serializeError } from '../shared/logger.js';

interface ErrorMapping {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/** Messages are ours, not body-parser's: body-parser's quote the input back. */
const CLIENT_ERRORS = new Map<number, { code: ErrorCode; message: string }>([
  [400, { code: 'VALIDATION_ERROR', message: 'Request body could not be read' }],
  [413, { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' }],
  [415, { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Request body encoding is not supported' }],
]);

const OTHER_CLIENT_ERROR = {
  code: 'BAD_REQUEST',
  message: 'Request could not be processed',
} as const;

const MAX_DETAILS = 20;

const SERVER_FAULT = { status: 500, code: 'INTERNAL', message: 'Internal server error' } as const;

/** Public wording for a 5xx. A code without an entry says nothing to a client. */
const SERVER_MESSAGES: Partial<Record<ErrorCode, string>> = {
  READ_MODEL_NOT_READY: 'The read model is not ready yet; retry shortly',
};

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

  return { status, ...(CLIENT_ERRORS.get(status) ?? OTHER_CLIENT_ERROR) };
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
  // The path is not echoed back: it is untrusted input.
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
      log.error({ error: serializeError(err) }, 'server fault raised by a handler');
    }
    const body: { error: Omit<ErrorMapping, 'status'> } = {
      error: { code: known.code, message: known.message },
    };
    if (known.details !== undefined) {
      // Bounded at the envelope every producer crosses, not at one of them: a
      // 100kb body of array items is thousands of zod issues, and an
      // unauthenticated request must not amplify into the response.
      // ponytail: truncated, not counted — the client fixes what it is shown,
      // and several round trips on a large batch is the accepted cost.
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
