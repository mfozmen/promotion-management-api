import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../shared/http-error.js';

/** Errors body-parser raises before routing, mapped to the API error shape. */
const BODY_PARSER_ERRORS: Record<string, AppError> = {
  'entity.too.large': new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large'),
  'entity.parse.failed': new AppError(400, 'VALIDATION_ERROR', 'Request body is not valid JSON'),
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  // The path is not echoed back: it is untrusted input.
  next(new AppError(404, 'NOT_FOUND', 'Route not found'));
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express recognises an error handler by its arity
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const known =
    err instanceof AppError ? err : BODY_PARSER_ERRORS[(err as { type?: string }).type ?? ''];

  if (known) {
    req.log.warn({ code: known.code, status: known.status }, 'request rejected');
    const body: { error: { code: string; message: string; details?: unknown } } = {
      error: { code: known.code, message: known.message },
    };
    if (known.details !== undefined) {
      body.error.details = known.details;
    }
    res.status(known.status).json(body);

    return;
  }

  // The stack goes to the log, never to the client (REVIEW.md §8.4).
  req.log.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
};
