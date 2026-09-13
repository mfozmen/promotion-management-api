import { driverFault } from './db/driver-fault.js';

/** Everything else a stack holds is the message, and a driver's message carries the statement. */
const FRAME = /^\s+at /;

interface Serialized {
  type: string;
  message: string;
  stack?: string;
  code?: string;
  constraint?: string;
}

/** Frames only. A stack begins with its message, so keeping it whole keeps the leak. */
function framesOf(stack: string | undefined): string | undefined {
  const frames = (stack ?? '')
    .split('\n')
    .filter((line) => FRAME.test(line))
    .join('\n');

  return frames === '' ? undefined : frames;
}

/**
 * Replaced on the wrapper, not on the fault: `drizzle-orm` wraps every query failure in a
 * `DrizzleQueryError` whose message is the statement and its bound values, and a connection loss
 * or a pool timeout carries no SQLSTATE at all. Keying on the fault would keep the message on
 * exactly the failures an incident is made of.
 */
function messageOf(error: Error, sqlState: string | undefined): string {
  return sqlState === undefined && !('query' in error) ? error.message : 'database error';
}

function describe(error: unknown): Serialized {
  if (!(error instanceof Error)) return { type: typeof error, message: String(error) };

  const fault = driverFault(error);
  const stack = framesOf(error.stack);
  const serialized: Serialized = {
    type: error.constructor.name,
    message: messageOf(error, fault?.sqlState),
  };

  if (stack !== undefined) serialized.stack = stack;
  // The code of whatever failed, whatever shape it is: without it a refused connection and a
  // rotated password read identically once the message is gone.
  if (fault?.code !== undefined) serialized.code = fault.code;
  if (fault?.constraint !== undefined) serialized.constraint = fault.constraint;

  return serialized;
}

/**
 * What a logged error is allowed to say. A `DrizzleQueryError` carries the failing statement
 * and the caller's bound values in its `message`, in its `stack`, and in `query` and `params`
 * as own properties that pino's default serializer copies verbatim — four places, so this
 * builds the line from a fixed set of fields rather than trimming the error's own
 * (REVIEW.md 8.4).
 */
export function serializeError(error: unknown): Serialized {
  try {
    return describe(error);
  } catch {
    // Not a silent catch: pino writes no line at all when a serializer throws, so propagating
    // would destroy the diagnostic this exists to protect. The condition is the return value,
    // and the input is by definition abnormal — a `message` getter that throws is reachable.
    return { type: 'UnserializableError', message: 'error could not be serialized' };
  }
}
