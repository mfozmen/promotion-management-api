import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pino, type Logger } from 'pino';
import { pinoHttp, type HttpLogger } from 'pino-http';

/**
 * The error a wrapper wraps. drizzle-orm builds its message out of the failing
 * statement and its bound parameters; the driver error underneath names the
 * constraint without the values, and carries the SQLSTATE.
 */
function rootCause(err: Error): Error {
  return err.cause instanceof Error ? err.cause : err;
}

/** Frames only: the first line of a stack repeats the message. */
function stackFrames(err: Error): string {
  return String(err.stack)
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .join('\n');
}

/**
 * Errors reach the log as a whitelist, under an `error` key. pino's own `err`
 * serializer writes an error's own fields, and a driver error keeps the
 * statement and the bound row there and in its message — which is the request
 * body with the customer's data in it. Frames locate the bug; the statement
 * belongs in the database's log.
 *
 * The `err` key is avoided rather than reconfigured: pino-http wraps a custom
 * `err` serializer around pino's own, so it would run on an already-flattened
 * object here and on a real Error elsewhere. One key, one shape.
 */
export function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) {
    // Not stringified: an unknown thrown value may itself be the leak.
    return { type: typeof err };
  }

  const root = rootCause(err);
  const { code } = root as Error & { code?: unknown };

  return {
    type: root.name,
    message: root.message,
    stack: stackFrames(err),
    code: typeof code === 'string' ? code : undefined,
  };
}

export const logger = pino();

/**
 * An incoming id is untrusted: a value carrying a newline forges whole log
 * lines, one carrying CR injects a response header. Anything that is not a
 * short safe token is replaced rather than rejected.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function correlationId(req: IncomingMessage, res: ServerResponse): string {
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
    // Headers, body and query string are never serialised, so no credential or
    // personal data can reach a line. pino's `redact` would have nothing left
    // to match and is deliberately not set.
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
