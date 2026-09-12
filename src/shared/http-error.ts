/**
 * Every code the API can answer with. One home, so a handler cannot invent a
 * tenth spelling and a client can branch on a closed set (ADR-0008).
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  // Two conflicts the case study names, kept distinct from the generic CONFLICT
  // because a client acts on them differently: a duplicate SKU means this is a
  // product that already exists, an overlap means this window is taken (#10, #11).
  | 'SKU_EXISTS'
  | 'PROMOTION_OVERLAP'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'BACKPRESSURE'
  | 'INTERNAL'
  | 'READ_MODEL_NOT_READY';

/**
 * The one status each code answers with. Exhaustive over `ErrorCode`, so a new
 * code cannot be added without deciding its status, the value type holds the
 * range so a typo cannot reach `res.status()`, the freeze below stops a row
 * being rewritten at runtime — `as const` is erased and would not — and a
 * caller cannot pair a code with a status that
 * contradicts it — that pairing was wrong in three
 * different directions before it stopped being expressible.
 */
export const STATUS = Object.freeze({
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SKU_EXISTS: 409,
  PROMOTION_OVERLAP: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  BACKPRESSURE: 429,
  INTERNAL: 500,
  READ_MODEL_NOT_READY: 503,
} as const satisfies Record<ErrorCode, 400 | 404 | 409 | 413 | 415 | 429 | 500 | 503>);

/**
 * An error raised at the HTTP boundary. Not the `HttpError` of the
 * `http-errors` package that body-parser throws — those are foreign, carry
 * their own arbitrary status, and are matched structurally in the error handler.
 *
 * A domain error does not belong here: a promotion overlap has no status until
 * a handler decides which code it is.
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = STATUS[code];
  }
}

/** Messages are ours, not body-parser's: body-parser's quote the input back.
 *  Frozen through the rows, because a shallow freeze holds the key-to-row
 *  binding and leaves the row writable — and the row's fields are what the
 *  envelope spreads into the response, so one assignment in any consumer of
 *  the built JavaScript would change the error body of every concurrent
 *  request. The readonly type is erased at build time; this is the control. */
export const CLIENT_ERRORS: Readonly<Record<number, { code: ErrorCode; message: string }>> =
  Object.freeze({
    400: Object.freeze({ code: 'VALIDATION_ERROR', message: 'Request body could not be read' }),
    413: Object.freeze({ code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' }),
    415: Object.freeze({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Request body encoding is not supported',
    }),
  } as const);

export const OTHER_CLIENT_ERROR = Object.freeze({
  code: 'BAD_REQUEST',
  message: 'Request could not be processed',
} as const);
