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

function describe(error: unknown): Serialized {
  if (!(error instanceof Error)) return { type: typeof error, message: String(error) };

  const fault = driverFault(error);
  const frames = (error.stack ?? '')
    .split('\n')
    .filter((line) => FRAME.test(line))
    .join('\n');

  return {
    type: error.constructor.name,
    // A driver message is replaced rather than trimmed: `invalid input syntax for type
    // integer: "..."` quotes the caller's value, so no driver message is safe by inspection.
    message: fault === undefined ? error.message : 'database error',
    ...(frames === '' ? {} : { stack: frames }),
    ...fault,
  };
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
