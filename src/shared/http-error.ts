/**
 * An error a handler raises on purpose: the middleware turns it into the API
 * error shape. The status and code are for the client to branch on, the message
 * for a human.
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
