import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pino, type Logger } from 'pino';
import { MAX_MESSAGE } from './max-message.js';
import { pinoHttp, type HttpLogger } from 'pino-http';

/** The whole chain, not one step: a repository that interpolates a driver
 *  message into its own sits between the handler's error and the statement,
 *  and a single step lands on that wrapper, which carries no `query` field to
 *  recognise it by. */
function causeChain(err: Error): Error[] {
  const chain = [err];
  for (let current = err.cause; current instanceof Error; current = current.cause) {
    chain.push(current);
  }
  return chain;
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

/** The statement text and bound values any level of the chain is holding. A
 *  driver error carries them on its own fields; a repository that wraps it
 *  often interpolates them into its message, where no field marks them.
 *  Ceiling: a bare pg error quotes them in forms no field carries (#41). */
function secrets(chain: readonly Error[]): string[] {
  return chain.flatMap((err) => {
    const { query, params } = err as Error & { query?: unknown; params?: unknown };
    return [query, ...(Array.isArray(params) ? params : [params])].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
  });
}

function safeMessage(err: Error, held: readonly string[]): string {
  // Cut at the first quoted value: a driver quotes what the caller sent.
  const message = err.message.split(': "')[0]!.slice(0, MAX_MESSAGE);

  // A message that repeats a statement or a bound value is the wrapper's own
  // work, and no part of it can be trusted; the constraint name a driver's own
  // message carries is what diagnoses the failure, so it survives.
  return held.some((secret) => message.includes(secret)) ? 'database query failed' : message;
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

  const chain = causeChain(err);
  const root = chain[chain.length - 1]!;
  const { code } = root as Error & { code?: unknown };

  return {
    type: root.name,
    message: safeMessage(root, secrets(chain)),
    stack: stackFrames(err),
    code: typeof code === 'string' ? code : undefined,
  };
}

export const logger = pino();

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
