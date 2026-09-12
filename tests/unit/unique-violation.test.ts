import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../../src/shared/db/unique-violation.js';

describe('isUniqueViolation', () => {
  it('recognises the driver error itself', () => {
    expect(isUniqueViolation(Object.assign(new Error('duplicate key'), { code: '23505' }))).toBe(
      true,
    );
  });

  it('recognises one wrapped by the ORM', () => {
    const driver = Object.assign(new Error('duplicate key'), { code: '23505' });
    expect(isUniqueViolation(new Error('Failed query', { cause: driver }))).toBe(true);
  });

  it('is false for another constraint', () => {
    // 23514 is check_violation: a real failure, but not this one, and answering
    // 409 SKU_EXISTS to it would tell the client to change a SKU that is fine.
    const driver = Object.assign(new Error('violates check constraint'), { code: '23514' });
    expect(isUniqueViolation(new Error('Failed query', { cause: driver }))).toBe(false);
  });

  it('is false for an error with no code at all', () => {
    expect(isUniqueViolation(new Error('connection terminated'))).toBe(false);
  });

  it('is false for a thrown non-error', () => {
    expect(isUniqueViolation('23505')).toBe(false);
  });

  it('gives up rather than following a cycle for ever', () => {
    const looping = new Error('outer');
    looping.cause = looping;
    expect(isUniqueViolation(looping)).toBe(false);
  });
});
