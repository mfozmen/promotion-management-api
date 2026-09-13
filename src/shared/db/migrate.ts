import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// Relative to the process working directory, which the image fixes at /app.
export const MIGRATIONS_FOLDER = 'src/shared/db/migrations';

/**
 * Not `createPool`, whose 10 s `statement_timeout` would kill a long index build at the same
 * second on every boot; `lock_timeout` bounds the wait instead, and is set on connect rather
 * than through `options`, which a `DATABASE_URL` carrying its own would replace silently.
 * ADR-0003. Exported so a test can watch a real session rather than the line that sets it.
 */
export function migrationPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: 1,
    statement_timeout: 0,
    idle_in_transaction_session_timeout: 0,
  });

  pool.on('connect', (client) => void client.query("set lock_timeout = '10s'"));

  return pool;
}

/** Brings a database up to the schema this build carries, then closes what it opened. ADR-0003. */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = migrationPool(connectionString);

  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
