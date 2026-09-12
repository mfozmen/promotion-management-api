import type { ErrorCode } from './error-code.js';
import { STATUS } from './status-by-code.js';
import type { ValidationDetail } from './validation-detail.js';

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
    readonly details?: readonly ValidationDetail[],
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = STATUS[code];
  }
}
