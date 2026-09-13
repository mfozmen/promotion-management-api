import { describe, expect, it } from 'vitest';
import { reconcileRun } from '@src/shared/reconcile-run.js';

describe('reconcileRun', () => {
  it('accepts the empty payload', () => {
    expect(reconcileRun.parse({})).toEqual({});
  });

  it('rejects any field at all, so a scope cannot be smuggled in unread', () => {
    expect(() => reconcileRun.parse({ anything: 1 })).toThrow();
  });
});
