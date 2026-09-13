import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 10_000,
  });
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
