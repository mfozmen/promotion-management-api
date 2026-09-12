import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../shared/http-error.js';
import { serializeError } from '../shared/logger.js';

interface ErrorMapping {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Body-parser fails before routing and marks its errors the http-errors way,
 * with a status and `expose: true`. Keying off the status rather than off
 * `err.type` answers all of them — a client that hangs up mid-upload, a body
 * that will not decompress — rather than the two types once written down, which
 * left the rest to be masked as 500s and to alert as server faults. The
 * installed parser answers every malformed body with 400 and only an oversized
 * one with 413; the messages are ours, because body-parser's quote the input.
 */
const CLIENT_ERRORS = new Map<number, { code: string; message: string }>([
  [400, { code: 'VALIDATION_ERROR', message: 'Request body could not be read' }],
  [413, { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' }],
]);

function clientError(err: unknown): ErrorMapping | undefined {
  const { status, expose } = err as { status?: unknown; expose?: unknown };
  if (expose !== true || typeof status !== 'number') {
    return undefined;
  }
  const mapped = CLIENT_ERRORS.get(status);

  return mapped && { status, ...mapped };
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  // The path is not echoed back: it is untrusted input.
  next(new AppError(404, 'NOT_FOUND', 'Route not found'));
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express recognises an error handler by its arity
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Once bytes are on the wire there is no envelope to write. The socket is
  // destroyed so the client sees a truncated body rather than a complete one,
  // and the error is never handed to Express, whose final handler would print
  // the raw stack — statement and bound row included — to stderr.
  if (res.headersSent) {
    req.log.error({ error: serializeError(err) }, 'unhandled error after the response started');
    res.destroy();

    return;
  }

  const known: ErrorMapping | undefined = err instanceof AppError ? err : clientError(err);

  if (known) {
    req.log.warn({ code: known.code, status: known.status }, 'request rejected');
    const body: { error: Omit<ErrorMapping, 'status'> } = {
      error: { code: known.code, message: known.message },
    };
    if (known.details !== undefined) {
      body.error.details = known.details;
    }
    res.status(known.status).json(body);

    return;
  }

  req.log.error({ error: serializeError(err) }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
};
