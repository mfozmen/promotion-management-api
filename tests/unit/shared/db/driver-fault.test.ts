import { describe, expect, it } from 'vitest';
import { driverFault } from '@src/shared/db/driver-fault.js';

const pgError = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('duplicate key'), { code, severity: 'ERROR', ...extra });

describe('driverFault', () => {
  it('finds the fault the ORM wrapped', () => {
    const wrapped = new Error('Failed query', { cause: pgError('23505') });

    expect(driverFault(wrapped)).toEqual({ code: '23505', sqlState: '23505' });
  });

  it('carries the constraint name when the server names one', () => {
    expect(driverFault(pgError('23505', { constraint: 'products_sku_unique' }))).toEqual({
      code: '23505',
      sqlState: '23505',
      constraint: 'products_sku_unique',
    });
  });

  it.each(['EPERM', 'EPIPE', 'EBUSY', 'EBADF', 'ENXIO'])(
    'reports the errno code %s without calling it a SQL fault',
    (code) => {
      // These are five characters too, so shape alone would label a filesystem fault a database
      // one and delete the operator's only message. The code is still worth reporting.
      const fsError = Object.assign(new Error(`${code}: operation not permitted`), { code });

      expect(driverFault(fsError)).toEqual({ code });
    },
  );

  it('reports a code that is not SQLSTATE-shaped at all', () => {
    // This is what tells a refused connection from a rotated password once the message is gone.
    expect(driverFault(Object.assign(new Error('down'), { code: 'ECONNREFUSED' }))).toEqual({
      code: 'ECONNREFUSED',
    });
  });

  it('reaches the server error under a wrapper carrying its own five-character code', () => {
    // What pins the `hasSqlState` rewrite: it used to scan every level for an exact match, and
    // now asks for the one SQL fault. An errno-coded wrapper must not shadow the pg error below.
    const wrapped = Object.assign(new Error('write failed'), {
      code: 'EPIPE',
      cause: pgError('23P01'),
    });

    expect(driverFault(wrapped)).toEqual({ code: 'EPIPE', sqlState: '23P01' });
  });

  it('gives up rather than following a cycle for ever', () => {
    const looping: Error & { cause?: unknown } = new Error('outer');
    looping.cause = looping;

    expect(driverFault(looping)).toBeUndefined();
  });

  it('is undefined when nothing in the chain carries a code', () => {
    expect(driverFault(new Error('connection terminated'))).toBeUndefined();
  });

  it('is undefined for a thrown non-error', () => {
    expect(driverFault('23505')).toBeUndefined();
  });
});
