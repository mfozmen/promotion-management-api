import { readModelUnavailable } from './read-model-unavailable.js';

/** A pipeline resolves with its failures instead of rejecting, so each reply
 *  carries its own error and a wrapper around `exec` never sees one. Measured
 *  against Redis: `-LOADING` on a restart, `-OOM`, `-BUSY`, `-MISCONF` and
 *  `-READONLY` all arrive as `ReplyError` alongside `-WRONGTYPE`, so the class
 *  says nothing about whether coming back would help. Only the string does.
 *  Everything else — a transport failure, and anything that is not an error at
 *  all — is the 503, because a wrong guess in that direction costs a retry and
 *  the other costs an outage answered with a status nothing retries. */
export function replyFailure(error: unknown): unknown {
  const permanent = error instanceof Error && error.message.startsWith('WRONGTYPE');

  return permanent ? error : readModelUnavailable(error);
}
