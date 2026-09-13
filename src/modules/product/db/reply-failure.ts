import { readModelUnavailable } from './read-model-unavailable.js';

/** ADR-0006. */
export function replyFailure(error: unknown, key?: string): unknown {
  if (!(error instanceof Error) || !error.message.startsWith('WRONGTYPE')) {
    return readModelUnavailable(error);
  }
  if (key === undefined) return error;

  const named = new Error(`${error.message} at ${key}`);
  named.name = error.name;

  return named;
}
