import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pino, type Logger } from 'pino';
import { pinoHttp, type HttpLogger } from 'pino-http';

/** drizzle-orm composes its message from the statement; the cause names the constraint and carries the SQLSTATE. */
function rootCause(err: Error): Error {
  return err.cause instanceof Error ? err.cause : err;
}

/** Anchored so a bound value carrying a newline and `at ` cannot pose as a frame. */
const FRAME = /^\s+at .*:\d+:\d+\)?$/;

function stackFrames(err: Error): string {
  // The message is skipped by line count, not by pattern: it is attacker-shaped.
  return String(err.stack)
    .split('\n')
    .slice(String(err.message).split('\n').length)
    .filter((line) => FRAME.test(line))
    .join('\n');
}

function safeMessage(err: Error): string {
  // One carrying a statement composed its message from it; others quote values.
  const { query, params } = err as Error & { query?: unknown; params?: unknown };
  if (query !== undefined || params !== undefined) {
    return 'database query failed';
  }

  return err.message.split(': "')[0]!.slice(0, 200);
}

/**
 * Contract for every log site (ADR-0009): errors go through this, under an
 * `error` key, never handed to a logger as an object — a driver error carries
 * the statement and bound row in its fields and its message, and pino-http
 * wraps a custom `err` serializer, so registering it there feeds it two shapes.
 */
export function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) {
    // Never the value itself: an unknown thrown object may be the leak.
    return { type: typeof err };
  }

  const root = rootCause(err);
  const { code } = root as Error & { code?: unknown };

  return {
    type: root.name,
    message: safeMessage(root),
    stack: stackFrames(err),
    code: typeof code === 'string' ? code : undefined,
  };
}

export const logger = pino();

/** An id carrying a newline forges log lines; one carrying CR injects a header. */
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
    // Headers, body and query string never reach a line (ADR-0009).
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
