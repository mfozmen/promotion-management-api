import { describe, expect, it } from 'vitest';
import { AppError } from '../src/shared/app-error.js';

describe('AppError', () => {
  it('keeps its status, code and message', () => {
    const error = new AppError(409, 'CONFLICT', 'Overlap');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.status).toBe(409);
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Overlap');
    expect(error.details).toBeUndefined();
  });

  it('carries details when a caller supplies them', () => {
    const details = [{ path: 'sku', message: 'Required' }];

    expect(new AppError(400, 'VALIDATION_ERROR', 'Invalid request body', details).details).toEqual(
      details,
    );
  });
});
