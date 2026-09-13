import type { ErrorRequestHandler } from 'express';
import createError from 'http-errors';

const INTERNAL_MESSAGE = 'Internal server error';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express recognises an error handler by its arity
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) {
    // No envelope fits over bytes already sent, and passing the error on reaches
    // Express's final handler, which prints the raw stack to stderr.
    req.log.error({ err }, 'unhandled error after the response started');
    res.destroy();

    return;
  }

  if (!createError.isHttpError(err)) {
    req.log.error({ err }, 'unhandled error');
    res.status(500).json({ error: { message: INTERNAL_MESSAGE } });

    return;
  }

  // `expose` is the library's answer to what a client may read — false for a 5xx
  // unless the raiser said otherwise — so a message written for an operator
  // cannot reach a caller by being forgotten about.
  const message = err.expose ? err.message : INTERNAL_MESSAGE;
  const headers = err.headers ?? {};
  // A retriable 5xx is an operating condition, not a fault: at `error` a rebuild
  // writes one alertable line per request and the real 500s sit inside that noise.
  // Matched without regard to case, because a header name is case-insensitive
  // everywhere else and a raiser spelling it `Retry-After` would page an
  // operator for an ordinary rebuild.
  const retriable = Object.keys(headers).some((name) => name.toLowerCase() === 'retry-after');

  if (err.status < 500 || retriable) {
    // `err` too: a retriable 5xx carries the driver failure as its cause, and
    // without it every outage line reads the same and nothing says which.
    req.log.warn({ status: err.status, reason: err.message, err }, 'request rejected');
  } else {
    req.log.error({ status: err.status, err }, 'server fault raised by a handler');
  }

  res.set(headers);

  res.status(err.status).json({ error: { message } });
};
