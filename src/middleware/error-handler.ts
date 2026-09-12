import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../shared/http-error.js';
import { serializeError } from '../shared/logger.js';

interface ErrorMapping {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** Keyed by body-parser's `err.type`. A Map, so `constructor` is not a hit. */
const BODY_PARSER_ERRORS = new Map<string, ErrorMapping>([
  [
    'entity.too.large',
    { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
  ],
  [
    'entity.parse.failed',
    { status: 400, code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON' },
  ],
]);

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  // The path is not echoed back: it is untrusted input.
  next(new AppError(404, 'NOT_FOUND', 'Route not found'));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // Nothing can be said in the envelope once bytes are on the wire. Express's
  // final handler destroys the connection, so the client sees a truncated body
  // rather than a complete one with an error appended.
  if (res.headersSent) {
    req.log.error({ error: serializeError(err) }, 'unhandled error after the response started');
    next(err);

    return;
  }

  const known: ErrorMapping | undefined =
    err instanceof AppError ? err : BODY_PARSER_ERRORS.get((err as { type?: string }).type ?? '');

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
