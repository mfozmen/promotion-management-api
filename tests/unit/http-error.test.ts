import { describe, expect, it } from 'vitest';
import { HttpError } from '../../src/shared/http-error.js';

describe('HttpError', () => {
  it('keeps its status, code and message', () => {
    const error = new HttpError(409, 'CONFLICT', 'Overlap');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('HttpError');
    expect(error.status).toBe(409);
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Overlap');
    expect(error.details).toBeUndefined();
  });

  it('carries details when a caller supplies them', () => {
    const details = [{ path: 'sku', message: 'Required' }];

    expect(new HttpError(400, 'VALIDATION_ERROR', 'Invalid request body', details).details).toEqual(
      details,
    );
  });
});
