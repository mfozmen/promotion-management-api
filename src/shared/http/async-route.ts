import type { RequestHandler } from 'express';

/**
 * Express 5 forwards a rejected promise to the error middleware, and this keeps
 * that true for a handler written as an async function: without it the rejection
 * escapes as an unhandled one and the request hangs until its socket times out.
 */
export function asyncRoute(
  work: (...args: Parameters<RequestHandler>) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    void work(req, res, next).catch(next);
  };
}
