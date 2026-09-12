import type { ErrorCode } from '../shared/http-error.js';

/** What the envelope needs to answer one error: the status to send, the code
 *  the client reads, the message it sees, and anything the producer attached. */
export interface ErrorMapping {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
}
