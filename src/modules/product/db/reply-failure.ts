import { readModelUnavailable } from './read-model-unavailable.js';

/** A pipeline resolves with its failures instead of rejecting, so each reply
 *  carries its own error and a wrapper around `exec` never sees one. Probed
 *  against the installed ioredis: a server-side error arrives as `ReplyError`
 *  and a connection that has gone as a plain `Error`, even with the offline
 *  queue off. The first is the writer having put something else at that key,
 *  which no amount of retrying fixes; the second is the same outage a direct
 *  command reports by rejecting. */
export function replyFailure(error: Error): unknown {
  return error.name === 'ReplyError' ? error : readModelUnavailable(error);
}
