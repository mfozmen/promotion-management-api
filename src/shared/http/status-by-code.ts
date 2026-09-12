import type { ErrorCode } from './error-code.js';

/**
 * The one status each code answers with. Exhaustive over `ErrorCode`, so a new
 * code cannot be added without deciding its status; the value type holds the
 * range so a typo cannot reach `res.status()`; the freeze stops a row being
 * rewritten at runtime, which `as const` alone would not, being erased at
 * build time. Pairing a code with a contradicting status was wrong in three
 * different directions before it stopped being expressible.
 */
export const STATUS = Object.freeze({
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  BACKPRESSURE: 429,
  INTERNAL: 500,
  READ_MODEL_NOT_READY: 503,
} as const satisfies Record<ErrorCode, 400 | 404 | 409 | 413 | 415 | 429 | 500 | 503>);
