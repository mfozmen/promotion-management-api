import { StatusCodes } from 'http-status-codes';
import type { ErrorCode } from './error-code.js';

/** What a foreign client error answers with, by its status. The messages are
 *  ours because body-parser's quote the input back. */
export const CLIENT_ERRORS: Record<number, { code: ErrorCode; message: string }> = {
  [StatusCodes.BAD_REQUEST]: {
    code: 'VALIDATION_ERROR',
    message: 'Request body could not be read',
  },
  [StatusCodes.REQUEST_TOO_LONG]: {
    code: 'PAYLOAD_TOO_LARGE',
    message: 'Request body is too large',
  },
  [StatusCodes.UNSUPPORTED_MEDIA_TYPE]: {
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Request body encoding is not supported',
  },
};
