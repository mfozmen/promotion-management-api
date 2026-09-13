/**
 * Every code the API can answer with. One home, so a handler cannot invent a
 * tenth spelling and a client can branch on a closed set (ADR-0009).
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  // Two conflicts the case study names, kept distinct from the generic CONFLICT
  // because a client acts on them differently: a duplicate SKU means this product
  // already exists, an overlap means this window is taken.
  | 'SKU_EXISTS'
  | 'PROMOTION_OVERLAP'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'BACKPRESSURE'
  | 'INTERNAL'
  | 'READ_MODEL_NOT_READY';
