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
  const retriable = headers['retry-after'] !== undefined;

  if (err.status < 500 || retriable) {
    // The message too: the client is told which part failed, and without this the
    // operator greps the reqId and finds only a status — knowing less than the caller.
    req.log.warn({ status: err.status, reason: err.message }, 'request rejected');
  } else {
    req.log.error({ status: err.status, err }, 'server fault raised by a handler');
  }

  res.set(headers);

  res.status(err.status).json({ error: { message } });
};
