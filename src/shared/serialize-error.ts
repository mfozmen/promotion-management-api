import { DrizzleQueryError } from 'drizzle-orm';
import { stdSerializers } from 'pino';

/** A stack begins with its message and pino appends `caused by:` sections; only frames are safe. */
const FRAME = /^\s+at /;

function framesOf(stack: string | undefined): string | undefined {
  const frames = (stack ?? '')
    .split('\n')
    .filter((line) => FRAME.test(line))
    .join('\n');

  return frames === '' ? undefined : frames;
}

/** The chain is walked rather than indexed into, the same idiom as `hasSqlState`: nesting
 *  depth is drizzle's business. Any error's code is worth a log line on its own - it is what
 *  tells a refused connection from every other 5xx without keeping the message that named it. */
function firstCode(error: Error): string | undefined {
  for (let current: unknown = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = current.cause;
  }

  return undefined;
}

/**
 * What a `DrizzleQueryError` is allowed to say. It carries the failing statement and the caller's
 * bound values in `message`, in `stack`, and in `query` and `params` as own properties, and its
 * cause's `detail` quotes the value a constraint rejected (REVIEW.md 8.4).
 */
function scrubbed(error: DrizzleQueryError, serialized: { type: string }): Record<string, unknown> {
  const cause = error.cause as { code?: unknown; constraint?: unknown } | undefined;
  const frames = framesOf(error.stack);
  const line: Record<string, unknown> = { type: serialized.type, message: 'database error' };

  if (frames !== undefined) line.stack = frames;
  // Without the code a refused connection and a rejected constraint read identically.
  if (typeof cause?.code === 'string') line.code = cause.code;
  if (typeof cause?.constraint === 'string') line.constraint = cause.constraint;

  return line;
}

/** pino's serializer first, so every other error keeps the cause chain `err` exists to carry. */
export function serializeError(error: unknown): Record<string, unknown> {
  try {
    if (!(error instanceof Error)) return { type: typeof error, message: String(error) };

    const serialized = stdSerializers.err(error);

    if (error instanceof DrizzleQueryError) return scrubbed(error, serialized);

    // Not a Drizzle failure, so the message is kept; a code lives further down the cause
    // chain than pino's own serializer looks, and dropping it is the regression this guards.
    const generic = serialized as unknown as Record<string, unknown>;
    if (!('code' in generic)) {
      const code = firstCode(error);
      if (code !== undefined) generic.code = code;
    }

    return generic;
  } catch {
    // pino writes no line at all when a serializer throws, so propagating would destroy the
    // diagnostic this exists to protect. A `message` getter that throws is reachable.
    return { type: 'UnserializableError', message: 'error could not be serialized' };
  }
}
