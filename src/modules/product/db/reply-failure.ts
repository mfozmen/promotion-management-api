import { readModelUnavailable } from './read-model-unavailable.js';

/** A pipeline resolves with its failures instead of rejecting, so each reply
 *  carries its own error and a wrapper around `exec` never sees one. Measured
 *  against Redis: `-LOADING` on a restart, `-OOM`, `-BUSY`, `-MISCONF` and
 *  `-READONLY` all arrive as `ReplyError` alongside `-WRONGTYPE`, so the class
 *  says nothing about whether coming back would help. Only the string does.
 *  Everything else — a transport failure, and anything that is not an error at
 *  all — is the 503, because a wrong guess in that direction costs a retry and
 *  the other costs an outage answered with a status nothing retries.
 *
 *  The key is attached on the `WRONGTYPE` branch alone. There it is evidence:
 *  a key of the wrong type exists because the writer made it, so the name is
 *  ours and it is what an operator fixes. On any other failure the key names
 *  what was being read rather than what is broken, and on the listing it is
 *  built from a query parameter — which would put a caller's text into an
 *  operator's line and let them forge an ` at product:7` onto the end of it.
 *  The transport error also travels whole rather than rebuilt, so every field
 *  the log whitelist grows next stays reachable without a second copy of that
 *  decision living here. */
export function replyFailure(error: unknown, key?: string): unknown {
  if (!(error instanceof Error) || !error.message.startsWith('WRONGTYPE')) {
    return readModelUnavailable(error);
  }
  if (key === undefined) return error;

  const named = new Error(`${error.message} at ${key}`);
  named.name = error.name;

  return named;
}
