import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// Relative to the process working directory, which the image fixes at /app. Exported so
// the test harness migrates from the same place rather than a second copy of the path.
export const MIGRATIONS_FOLDER = 'src/shared/db/migrations';

/**
 * Brings a database up to the schema this build carries, then closes what it opened.
 *
 * The api entrypoint calls this before it serves, which is why there is no migration
 * service and no operator step: `__drizzle_migrations` records what has been applied, so a
 * fresh volume and a warm one both end current, and every boot can call it.
 *
 * `drizzle-orm`'s migrator rather than `drizzle-kit`: the kit is a devDependency, so a
 * container that called it would have to reach the registry at start.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  // Its own pool, not `createPool`: that one carries a 10 s `statement_timeout`, and an
  // index build killed halfway leaves `__drizzle_migrations` unwritten, so the next boot
  // replays the same statement and is killed at the same second, for ever.
  const pool = new Pool({
    connectionString,
    max: 1,
    statement_timeout: 0,
    idle_in_transaction_session_timeout: 0,
    // `statement_timeout: 0` is for the length of the work, not for the wait to start it.
    // Without a lock timeout an `ALTER TABLE` behind one idle transaction waits for ever,
    // holding the locks it already took and queueing every reader behind its request, and
    // the container never exits so nothing restarts it.
    options: '-c lock_timeout=10s',
  });

  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
