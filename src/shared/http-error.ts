/**
 * Every code the API can answer with. One home, so a handler cannot invent a
 * tenth spelling and a client can branch on a closed set (ADR-0008).
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'BACKPRESSURE'
  | 'INTERNAL'
  | 'READ_MODEL_NOT_READY';

/**
 * The one status each code answers with. Exhaustive over `ErrorCode`, so a new
 * code cannot be added without deciding its status, the value type holds the
 * range so a typo cannot reach `res.status()`, `as const` stops anything
 * rewriting a row at runtime, and a caller cannot pair a code with a status that
 * contradicts it — that pairing was wrong in three
 * different directions before it stopped being expressible.
 */
export const STATUS = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  BACKPRESSURE: 429,
  INTERNAL: 500,
  READ_MODEL_NOT_READY: 503,
} as const satisfies Record<ErrorCode, 400 | 404 | 409 | 413 | 415 | 429 | 500 | 503>;

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
