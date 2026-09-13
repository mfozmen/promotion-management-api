import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// Relative to the process working directory, which the image fixes at /app.
export const MIGRATIONS_FOLDER = 'src/shared/db/migrations';

/** Brings a database up to the schema this build carries, then closes what it opened. ADR-0003. */
export async function runMigrations(connectionString: string): Promise<void> {
  // Its own pool, not `createPool`, whose 10 s `statement_timeout` would kill a long index
  // build at the same second on every boot. ADR-0003.
  const pool = new Pool({
    connectionString,
    max: 1,
    statement_timeout: 0,
    idle_in_transaction_session_timeout: 0,
    // `statement_timeout` bounds the work, `lock_timeout` the wait to start it. ADR-0003.
    options: '-c lock_timeout=10s',
  });

  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
