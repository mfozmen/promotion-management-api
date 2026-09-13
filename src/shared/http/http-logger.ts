import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import { pinoHttp, type HttpLogger } from 'pino-http';
import { serializeError } from '../serialize-error.js';

/** An id carrying a newline forges log lines; one carrying CR injects a header. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

function correlationId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', id);

  return id;
}

export function httpLogger(instance: Logger): HttpLogger {
  return pinoHttp({
    logger: instance,
    genReqId: correlationId,
    // Binds the id as `reqId` on `req.log`, so a handler's own lines carry it.
    quietReqLogger: true,
    autoLogging: {
      // The dashboard polls and loads its own assets: 64 lines a minute with nobody
      // looking at it, which buries the request lines an operator came for.
      ignore: (req: IncomingMessage) => String(req.url).startsWith('/admin/queues'),
    },
    // Headers, body and query string never reach a line (ADR-0010).
    // `pino-http` wraps every serializer by default: pino's own runs first and ours receives the
    // result, so `serializeError` would be handed a plain object rather than the error and would
    // report `[object Object]`. Off, so each serializer gets the value it was written for.
    wrapSerializers: false,
    serializers: {
      // pino-http installs pino's default `err` serializer and applies the block as a child
      // logger, and a child's serializers override the root's — so without this line every
      // `req.log.error({ err })` writes the statement and its bound values (REVIEW.md 8.4).
      err: serializeError,
      req: (req: IncomingMessage) => ({
        id: req.id,
        method: req.method,
        path: String(req.url).split('?')[0],
      }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },
  });
}
