import { readModelUnavailable } from './read-model-unavailable.js';

/** Which Redis failures are permanent, and why only this branch names a key:
 *  ADR-0006. The short of it: the class is shared with `-LOADING` and friends,
 *  so the string decides. */
export function replyFailure(error: unknown, key?: string): unknown {
  if (!(error instanceof Error) || !error.message.startsWith('WRONGTYPE')) {
    return readModelUnavailable(error);
  }
  if (key === undefined) return error;

  const named = new Error(`${error.message} at ${key}`);
  named.name = error.name;

  return named;
}
