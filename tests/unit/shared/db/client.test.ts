import { describe, expect, it, vi } from 'vitest';
import { createPool } from '@src/shared/db/client.js';
import { logger } from '@src/shared/logger.js';

describe('createPool', () => {
  it('logs an idle client failure rather than letting the process exit', async () => {
    // node-postgres documents that a pool error with no listener is fatal: the
    // database restarting would otherwise take the HTTP listener with it, and the
    // storefront reads that never touch PostgreSQL would fail for its duration.
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const pool = createPool('postgres://nobody@127.0.0.1:1/none');

    pool.emit('error', new Error('terminating connection due to administrator command'));
    await pool.end();

    expect(error).toHaveBeenCalledWith(
      { err: expect.any(Error) as Error },
      'idle database client failed',
    );
  });
});
