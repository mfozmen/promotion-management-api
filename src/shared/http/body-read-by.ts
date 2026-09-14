import type { RequestHandler } from 'express';

/**
 * Marks a handler whose request body is read by something no zod schema
 * describes, with the content type and fields it takes, for the document to
 * publish on that operation.
 *
 * It wraps rather than stamps the handler it is given: stamping would mark
 * every route sharing that reference, and a handler is a value a caller may
 * reuse. `validate()` is safe stamping its own because it builds a new closure
 * per call; this one is handed somebody else's.
 */
export function bodyReadBy(handler: RequestHandler, takes: string): RequestHandler {
  const marked: RequestHandler = (req, res, next) => handler(req, res, next);
  (marked as unknown as Record<symbol, string>)[Symbol.for('pma.bodyReadBy')] = takes;

  return marked;
}
