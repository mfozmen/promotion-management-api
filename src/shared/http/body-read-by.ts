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
 *
 * Wrapping resets arity, and Express reads `Function.length` to decide what is
 * an error handler, so a four-argument one would come back as an ordinary
 * handler and its errors would go unhandled. Refused rather than written down.
 */
export function bodyReadBy(handler: RequestHandler, takes: string): RequestHandler {
  if (handler.length === 4) throw new TypeError('bodyReadBy cannot mark an error handler');

  const marked: RequestHandler = (req, res, next) => handler(req, res, next);
  (marked as unknown as Record<symbol, string>)[Symbol.for('pma.bodyReadBy')] = takes;

  return marked;
}
