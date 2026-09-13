import createError, { type HttpError } from 'http-errors';
import type { PromotionWriteOutcome } from '../domain/dto/promotion-write-outcome.js';

/**
 * The one place a failed promotion write becomes a status.
 *
 * The overlap 409 names no promotion. The envelope carries a message and nothing
 * else, and another row's identifier is not the caller's to read (REVIEW.md 8.3b).
 * The cost is real and worth stating: an admin refused a promotion compares
 * windows across the active rows for that target to find the one in the way.
 */
export function promotionWriteError(
  outcome: Extract<PromotionWriteOutcome, { ok: false }>,
): HttpError {
  if (outcome.reason === 'no-such-product') return createError(404, 'No such product');
  if (outcome.reason === 'not-found') return createError(404, 'No such promotion');
  if (outcome.reason === 'not-assignable') {
    return createError(409, 'Only a draft whose window has not passed can be assigned a target');
  }
  return createError(409, 'An active promotion already covers that target for this window');
}
