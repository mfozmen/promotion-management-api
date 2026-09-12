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

const SERVER_FAULT = { status: 500, code: 'INTERNAL', message: 'Internal server error' } as const;

/**
 * A 5xx a handler designed, so the prose is ours by construction rather than by
 * trust: `503` tells a client to retry, and answering it with "Internal server
 * error" tells the human reading the body the wrong thing.
 */
const SERVER_MESSAGES = new Map<ErrorCode, string>([
  ['READ_MODEL_NOT_READY', 'The read model is not ready yet; retry shortly'],
]);

/**
 * Express 5 throws a `RangeError` for a status outside [100, 999], so an
 * unbounded one turns the error handler itself into the failure.
 */
const isClientStatus = (status: unknown): status is number =>
  typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 499;

const isServerStatus = (status: unknown): status is number =>
  typeof status === 'number' && Number.isInteger(status) && status >= 500 && status <= 599;

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
 * for an operator, so only its status and code cross. `503
 * READ_MODEL_NOT_READY` stays branchable by the client without its prose.
 */
function raisedError(err: HttpError): ErrorMapping {
  if (isClientStatus(err.status)) {
    return err;
  }
  if (!isServerStatus(err.status)) {
    return SERVER_FAULT;
  }
  // The status survives — `502` and `504` are what an operator needs — but the
  // code and the words cross only where we wrote public ones for that code. A
  // client branching on `CONFLICT` must never see it on a read-model outage.
  const message = SERVER_MESSAGES.get(err.code);

  return message
    ? { status: err.status, code: err.code, message }
    : { ...SERVER_FAULT, status: err.status };
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  // The path is not echoed back: it is untrusted input.
  next(new HttpError(404, 'NOT_FOUND', 'Route not found'));
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
      body.error.details = known.details;
    }
    res.status(known.status).json(body);

    return;
  }

  log.error({ error: serializeError(err) }, 'unhandled error');
  res
    .status(SERVER_FAULT.status)
    .json({ error: { code: SERVER_FAULT.code, message: SERVER_FAULT.message } });
};
