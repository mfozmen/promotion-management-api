import { HttpError } from '../../../shared/http/http-error.js';

/** Redis is the storefront's only store, so it being unreachable is the same
 *  answer to a client as a read model that is not built yet: come back, with a
 *  number (design §5). A plain rethrow would answer 500 and invite an
 *  immediate retry into a recovering server. */
export function readModelUnavailable(cause: unknown): HttpError {
  const failed = new HttpError('READ_MODEL_NOT_READY', 'The read model cannot be reached');
  failed.cause = cause;

  return failed;
}
