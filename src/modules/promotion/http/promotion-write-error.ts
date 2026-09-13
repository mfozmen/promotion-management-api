import createError, { type HttpError } from 'http-errors';
import type { PromotionWriteOutcome } from '../domain/dto/promotion-write-outcome.js';

/**
 * The one place a failed promotion write becomes a status.
 *
 * The overlap 409 names no promotion. It used to carry the conflicting row's id
 * in `details.conflictingPromotionId`, argued as the one exception worth making;
 * the envelope has since dropped `details` entirely, and the exception was always
 * the weaker half of the argument — ADR-0004 records that handing a caller another
 * row's identifier is what REVIEW.md 8.3b forbids. The message says what happened
 * and the admin's own list says which promotion it was.
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
