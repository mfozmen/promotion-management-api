import { describe, expect, it } from 'vitest';
import { reconcilerRun } from '@src/events/reconciler-run.js';

describe('reconcilerRun', () => {
  it('accepts the empty payload', () => {
    expect(reconcilerRun.parse({})).toEqual({});
  });

  it('rejects any field at all, so a scope cannot be smuggled in unread', () => {
    expect(() => reconcilerRun.parse({ anything: 1 })).toThrow();
  });
});
