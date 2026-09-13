import { HttpError } from '../../../shared/http-error.js';
import type { PromotionWriteOutcome } from '../db/promotion-write-outcome.js';

/** The one place a failed promotion write becomes a status. */
export function promotionWriteError(outcome: Extract<PromotionWriteOutcome, { ok: false }>): HttpError {
  if (outcome.reason === 'not-found') {
    return new HttpError('NOT_FOUND', 'No such promotion');
  }
  if (outcome.reason === 'not-assignable') {
    return new HttpError(
      'CONFLICT',
      'Only a draft whose window has not passed can be assigned a target',
    );
  }
  return new HttpError('PROMOTION_OVERLAP', 'Another active promotion already covers that window', {
    conflictingPromotionId: outcome.conflictingPromotionId,
  });
}
