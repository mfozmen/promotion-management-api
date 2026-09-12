import type { ErrorCode } from '../shared/http-error.js';
import type { ValidationDetail } from '../shared/validation-detail.js';

export interface ErrorMapping {
  status: number;
  code: ErrorCode;
  message: string;
  /** Closed, not `unknown`: a value `res.json` cannot serialise — a `bigint`
   *  price, a cycle — threw inside the envelope and fell through to Express's
   *  HTML error page with the status intact. */
  details?: readonly ValidationDetail[];
}
