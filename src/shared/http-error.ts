/**
 * Every code the API can answer with. One home, so a handler cannot invent a
 * ninth spelling and a client can branch on a closed set (ADR-0008).
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
 * An error raised at the HTTP boundary, carrying the status it becomes. Not the
 * `HttpError` of the `http-errors` package that body-parser throws — those are
 * matched structurally, by `expose` and `status`, in the error handler.
 *
 * A domain error does not belong here: a promotion overlap has no status until
 * a handler decides one.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
