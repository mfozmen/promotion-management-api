import type { ErrorCode } from './error-code.js';

/** What a foreign client error answers with, by its status. The messages are
 *  ours because body-parser's quote the input back.
 *
 *  Frozen through the rows: a shallow freeze holds the key-to-row binding and
 *  leaves the row writable, and a row's fields are what the envelope spreads
 *  into the response, so one assignment in any consumer of the built
 *  JavaScript would change the error body of every concurrent request. */
export const CLIENT_ERRORS: Readonly<Record<number, { code: ErrorCode; message: string }>> =
  Object.freeze({
    400: Object.freeze({ code: 'VALIDATION_ERROR', message: 'Request body could not be read' }),
    413: Object.freeze({ code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' }),
    415: Object.freeze({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Request body encoding is not supported',
    }),
  } as const);
