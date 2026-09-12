import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../shared/http-error.js';
import { logger, serializeError } from '../shared/logger.js';

interface ErrorMapping {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** Messages are ours, not body-parser's: body-parser's quote the input back. */
const CLIENT_ERRORS = new Map<number, { code: string; message: string }>([
  [400, { code: 'VALIDATION_ERROR', message: 'Request body could not be read' }],
  [413, { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' }],
  [415, { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Request body encoding is not supported' }],
]);

const OTHER_CLIENT_ERROR = { code: 'BAD_REQUEST', message: 'Request could not be processed' };

/** Any error marked the http-errors way keeps its status, unless it claims a server fault. */
function clientError(err: unknown): ErrorMapping | undefined {
  const { status, expose } = err as { status?: unknown; expose?: unknown };
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
