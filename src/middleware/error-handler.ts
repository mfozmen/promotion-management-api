import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../shared/http-error.js';
import { logger, serializeError } from '../shared/logger.js';

interface ErrorMapping {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Body-parser fails before routing and marks its errors the http-errors way,
 * with a status and `expose: true`. Any of them keeps its status; this names
 * the ones worth a specific code. Enumerating instead — two `err.type` values,
 * or three statuses — is what made an unsupported charset a 500 that alerted as
 * a server fault. The messages are ours, because body-parser's quote the input.
 */
const CLIENT_ERRORS = new Map<number, { code: string; message: string }>([
  [400, { code: 'VALIDATION_ERROR', message: 'Request body could not be read' }],
  [413, { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' }],
  [415, { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Request body encoding is not supported' }],
]);

const OTHER_CLIENT_ERROR = { code: 'BAD_REQUEST', message: 'Request could not be processed' };

function clientError(err: unknown): ErrorMapping | undefined {
  const { status, expose } = err as { status?: unknown; expose?: unknown };
  // A server fault is never relabelled as the client's mistake, whatever it
  // claims about itself.
  if (expose !== true || typeof status !== 'number' || status >= 500) {
    return undefined;
  }

  return { status, ...(CLIENT_ERRORS.get(status) ?? OTHER_CLIENT_ERROR) };
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  // The path is not echoed back: it is untrusted input.
  next(new AppError(404, 'NOT_FOUND', 'Route not found'));
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express recognises an error handler by its arity
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Falls back to the root logger: without one, this handler throws and Express
  // prints the raw stack to stderr — the leak it exists to prevent.
  const log = req.log ?? logger;

  // Once bytes are on the wire there is no envelope to write. The socket is
  // destroyed so the client sees a truncated body rather than a complete one,
  // and the error is never handed to Express, whose final handler would print
  // that same raw stack.
  if (res.headersSent) {
    log.error({ error: serializeError(err) }, 'unhandled error after the response started');
    res.destroy();

    return;
  }

  const known: ErrorMapping | undefined = err instanceof AppError ? err : clientError(err);

  if (known) {
    log.warn({ code: known.code, status: known.status }, 'request rejected');
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
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
};
