import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

// REVIEW.md 6.19: one pool per process, and no statement may hold a connection for ever.
export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 10_000,
  });
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;
