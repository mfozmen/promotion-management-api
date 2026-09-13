import { StatusCodes } from 'http-status-codes';
import type { ErrorCode } from './error-code.js';

/** The one status each code answers with, exhaustive over `ErrorCode`. */
export const STATUS: Record<ErrorCode, StatusCodes> = {
  VALIDATION_ERROR: StatusCodes.BAD_REQUEST,
  BAD_REQUEST: StatusCodes.BAD_REQUEST,
  NOT_FOUND: StatusCodes.NOT_FOUND,
  CONFLICT: StatusCodes.CONFLICT,
  BACKPRESSURE: StatusCodes.TOO_MANY_REQUESTS,
  INTERNAL: StatusCodes.INTERNAL_SERVER_ERROR,
  READ_MODEL_NOT_READY: StatusCodes.SERVICE_UNAVAILABLE,
};
