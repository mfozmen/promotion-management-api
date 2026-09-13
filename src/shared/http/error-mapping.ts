import type { ErrorCode } from './error-code.js';
import type { ConflictDetail } from './conflict-detail.js';
import type { ValidationDetail } from './validation-detail.js';

export interface ErrorMapping {
  status: number;
  code: ErrorCode;
  message: string;
  /** Closed, not `unknown`: a value `res.json` cannot serialise — a `bigint`
   *  price, a cycle — threw inside the envelope and fell through to Express's
   *  HTML error page with the status intact. */
  details?: readonly ValidationDetail[] | ConflictDetail;
}
