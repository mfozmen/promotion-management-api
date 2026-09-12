/**
 * An error a handler raises on purpose. The middleware turns it into the API
 * error shape `{ error: { code, message, details? } }` (REVIEW.md §8.3): the
 * status and code are for the client to branch on, the message is for a human.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
