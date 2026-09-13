import { MAX_MESSAGE } from './max-message.js';

/** Below this a bound value is too short to reveal anything and too common to
 *  search for. */
const MIN_SECRET = 8;

/** The whole chain, not one step: a repository that interpolates a driver
 *  message into its own sits between the handler's error and the statement,
 *  and a single step lands on that wrapper, which carries no `query` field to
 *  recognise it by. */
function causeChain(err: Error): Error[] {
  const chain = [err];
  // Stops on a cycle: a retry wrapper that re-attaches the error it caught
  // makes one, and an uncapped walk allocates until it throws — inside the
  // error handler, which is how Express's HTML page reaches a client.
  const seen = new Set<Error>([err]);
  for (let current = err.cause; current instanceof Error && !seen.has(current);) {
    chain.push(current);
    seen.add(current);
    current = current.cause;
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
 *  Ceiling: a bare pg error quotes them in forms no field carries, which the
 *  first branch to touch the database owns against real driver errors. */
function secrets(chain: readonly Error[]): string[] {
  return chain.flatMap((err) => {
    const { query, params } = err as Error & { query?: unknown; params?: unknown };
    return [query, ...(Array.isArray(params) ? params : [params])].filter(
      // Long enough to be worth hiding. A statement is always long; a bound
      // value of one or two characters appears in any English sentence, so
      // searching for it would replace the constraint name that diagnoses the
      // failure — and the caller chooses that length.
      (value): value is string => typeof value === 'string' && value.length >= MIN_SECRET,
    );
  });
}

function safeMessage(err: Error, held: readonly string[]): string {
  // Cut at the first quoted value: a driver quotes what the caller sent.
  const message = err.message.split(': "')[0]!;

  // Compared before the bound is applied, not after: a statement quoted past
  // the bound is absent from the truncated string, so the check would miss it
  // and the prefix would go to the log.
  if (held.some((secret) => message.includes(secret))) {
    return 'database query failed';
  }
  return message.slice(0, MAX_MESSAGE);
}

/**
 * Contract for every log site (ADR-0010): errors go through this, under an
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
