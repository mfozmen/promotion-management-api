import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

// One pool per process; the two timeouts stop a single statement or an abandoned
// transaction holding a connection for ever.
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
