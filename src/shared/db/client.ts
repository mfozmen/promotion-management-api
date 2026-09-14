import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { logger } from '../logger.js';

export function createPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: 10,
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 10_000,
  });

  // An idle client whose server goes away emits on the pool, and node-postgres
  // documents that with no listener the process exits. A database restart would
  // otherwise take the HTTP listener with it.
  pool.on('error', (error) => {
    logger.error({ err: error }, 'idle database client failed');
  });

  return pool;
}

export function createDb(pool: Pool) {
  return drizzle(pool);
}

export type Db = ReturnType<typeof createDb>;

/**
 * A database handle, or a transaction on one. A query a caller may need to run
 * inside its own transaction takes this rather than `Db`, so the caller decides
 * the boundary and the query does not open one of its own.
 */
export type Queryable = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
