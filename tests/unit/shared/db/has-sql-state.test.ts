import { describe, expect, it } from 'vitest';
import { hasSqlState } from '@src/shared/db/has-sql-state.js';
import { SqlState } from '@src/shared/db/sql-state.js';

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

describe('hasSqlState', () => {
  it('recognises the driver error itself', () => {
    expect(hasSqlState(withCode('duplicate key', '23505'), SqlState.uniqueViolation)).toBe(true);
  });

  it('recognises one wrapped by the ORM', () => {
    const driver = withCode('duplicate key', '23505');

    expect(
      hasSqlState(new Error('Failed query', { cause: driver }), SqlState.uniqueViolation),
    ).toBe(true);
  });

  it('is false for another constraint', () => {
    // 23514 is check_violation: a real failure, but not this one, and answering
    // 409 to it would tell the client to change a SKU that is fine.
    const driver = withCode('violates check constraint', '23514');

    expect(
      hasSqlState(new Error('Failed query', { cause: driver }), SqlState.uniqueViolation),
    ).toBe(false);
  });

  it('tells the three codes apart rather than answering any of them', () => {
    const exclusion = withCode('conflicting key value', '23P01');

    expect(hasSqlState(exclusion, SqlState.exclusionViolation)).toBe(true);
    expect(hasSqlState(exclusion, SqlState.uniqueViolation)).toBe(false);
    expect(hasSqlState(exclusion, SqlState.foreignKeyViolation)).toBe(false);
  });

  it('is false for an error with no code at all', () => {
    expect(hasSqlState(new Error('connection terminated'), SqlState.uniqueViolation)).toBe(false);
  });

  it('is false for a thrown non-error', () => {
    expect(hasSqlState('23505', SqlState.uniqueViolation)).toBe(false);
  });

  it('gives up rather than following a cycle for ever', () => {
    const looping = new Error('outer');
    looping.cause = looping;

    expect(hasSqlState(looping, SqlState.uniqueViolation)).toBe(false);
  });
});
