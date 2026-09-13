import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import { pinoHttp, type HttpLogger } from 'pino-http';

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
    // Headers, body and query string never reach a line (ADR-0010).
    serializers: {
      req: (req: IncomingMessage) => ({
        id: req.id,
        method: req.method,
        path: String(req.url).split('?')[0],
      }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },
  });
}
