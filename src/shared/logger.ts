import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pino, type Logger } from 'pino';
import { pinoHttp, type HttpLogger } from 'pino-http';

export const logger = pino({
  // REVIEW.md §10.3: credentials never reach a log line.
  redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'],
});

/**
 * An incoming correlation id is untrusted input, so it is accepted only as a
 * short safe token; anything else (including a header carrying newlines, which
 * would forge log lines or response headers) is replaced by a generated uuid.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function correlationId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', id);

  return id;
}

/**
 * Structured JSON request logging. `quietReqLogger` binds the correlation id as
 * `reqId` on `req.log`, so every line a handler writes carries it too
 * (REVIEW.md §10.1), and one request-completed line closes each request.
 */
export function httpLogger(instance: Logger): HttpLogger {
  return pinoHttp({
    logger: instance,
    genReqId: correlationId,
    quietReqLogger: true,
    // Only what identifies the request. Headers, body and the query string are
    // never logged, so no credential or personal data can reach a log line
    // (REVIEW.md §10.3); the query string is dropped because an endpoint that
    // one day takes a token or an email as a parameter would otherwise write it
    // on every line.
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
