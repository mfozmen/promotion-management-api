import { StatusCodes } from 'http-status-codes';
import { describe, expect, it } from 'vitest';
import { STATUS } from '@src/shared/http/status-by-code.js';

describe('STATUS', () => {
  // `Record<ErrorCode, StatusCodes>` makes the table exhaustive over the codes and
  // says nothing about which status each takes, so `NOT_FOUND: StatusCodes.OK`
  // typechecks. Nothing else asserts a row: a typo here reaches `res.status()`.
  it('answers each code with the status the envelope promises', () => {
    expect(STATUS).toEqual({
      VALIDATION_ERROR: StatusCodes.BAD_REQUEST,
      BAD_REQUEST: StatusCodes.BAD_REQUEST,
      NOT_FOUND: StatusCodes.NOT_FOUND,
      CONFLICT: StatusCodes.CONFLICT,
      BACKPRESSURE: StatusCodes.TOO_MANY_REQUESTS,
      INTERNAL: StatusCodes.INTERNAL_SERVER_ERROR,
      READ_MODEL_NOT_READY: StatusCodes.SERVICE_UNAVAILABLE,
    });
  });

  it('gives every code a status a client can act on', () => {
    // A 2xx or a 3xx in this table would be an error reported as a success.
    for (const status of Object.values(STATUS)) {
      expect(status).toBeGreaterThanOrEqual(StatusCodes.BAD_REQUEST);
      expect(status).toBeLessThan(600);
    }
  });
});
