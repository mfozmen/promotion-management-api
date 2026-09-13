import createError from 'http-errors';
import { RETRY_AFTER } from './retry-after.js';

/** Redis is the storefront's only store, so it being unreachable is the same
 *  answer to a client as a read model that is not built yet: come back, with a
 *  number (ADR-0006). A plain rethrow would answer 500 and invite an immediate
 *  retry into a recovering server. */
export function readModelUnavailable(cause: unknown): Error {
  return createError(503, 'The read model cannot be reached', {
    // A 5xx withholds its message by default, and this one is written for the
    // caller rather than the operator.
    expose: true,
    headers: { 'retry-after': RETRY_AFTER() },
    cause,
  });
}
