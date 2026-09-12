import { describe, expect, it } from 'vitest';
import { CLIENT_ERRORS } from '../../../../src/shared/http/client-errors.js';
import { HttpError } from '../../../../src/shared/http/http-error.js';
import { STATUS } from '../../../../src/shared/http/status-by-code.js';

describe('HttpError', () => {
  it('keeps its status, code and message', () => {
    const error = new HttpError('CONFLICT', 'Overlap');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('HttpError');
    expect(error.status).toBe(409);
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Overlap');
    expect(error.details).toBeUndefined();
  });

  it('carries details when a caller supplies them', () => {
    const details = [{ path: 'sku', message: 'Required' }];

    expect(new HttpError('VALIDATION_ERROR', 'Invalid request body', details).details).toEqual(
      details,
    );
  });
});

describe('the error tables', () => {
  // The readonly types are erased at build time, so without the freeze a
  // consumer of the built JavaScript could rewrite one row and change the
  // error body of every concurrent request in the process.
  it('cannot be rewritten at runtime', () => {
    expect(() => {
      (STATUS as Record<string, number>).NOT_FOUND = 500;
    }).toThrow(TypeError);
    expect(() => {
      (CLIENT_ERRORS as Record<number, unknown>)[413] = { code: 'INTERNAL', message: 'leaked' };
    }).toThrow(TypeError);
  });

  // A shallow freeze holds the key-to-row binding and leaves the row writable,
  // and the row's fields are what the envelope spreads into the response.
  it('cannot have a row rewritten either', () => {
    expect(() => {
      (CLIENT_ERRORS[413] as { message: string }).message = 'connect pg://user:secret@db';
    }).toThrow(TypeError);
    expect(CLIENT_ERRORS[413]?.message).toBe('Request body is too large');
  });
});
