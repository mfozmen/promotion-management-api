import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { adminUrl, templateDatabase, urlFor } from './env.js';

const STALE_AFTER_MS = 3_600_000;

/**
 * A killed run cannot drop its clone, so abandoned ones are swept here. Scoped by age and
 * never forced: a dozen worktrees share this server under the same name prefix, so a clone
 * younger than an hour, or one another process still holds open, belongs to a run in
 * progress. A `like` is not ownership.
 */
export async function sweepStaleClones(admin: Client, now = Date.now()): Promise<void> {
  const stale = await admin.query<{ datname: string }>(
    `select datname from pg_database
      where datname ~ '^pma_test_[0-9]+_' and split_part(datname, '_', 3)::bigint < $1`,
    [now - STALE_AFTER_MS],
  );
  for (const { datname } of stale.rows) {
    try {
      await admin.query(`drop database if exists "${datname}"`);
    } catch {
      // Open, so not abandoned after all; the run that holds it drops it itself.
    }
  }
}

export default async function setup(): Promise<void> {
  const admin = new Client({ connectionString: adminUrl });
  try {
    await admin.connect();
  } catch {
    throw new Error(
      `PostgreSQL not reachable at ${adminUrl}; start it with: docker compose up db (or the docker run one-liner in README.md)`,
    );
  }
  await sweepStaleClones(admin);
  // Named after this checkout, so rebuilding the template races no other worktree.
  await admin.query(`drop database if exists "${templateDatabase}" with (force)`);
  await admin.query(`create database "${templateDatabase}"`);
  await admin.end();

  // Migrations get no timeouts: an index build aborted halfway leaves __drizzle_migrations
  // unwritten, so the retry replays the same statement for ever.
  const pool = new Pool({
    connectionString: urlFor(templateDatabase),
    max: 1,
    statement_timeout: 0,
    idle_in_transaction_session_timeout: 0,
  });
  await migrate(drizzle(pool), { migrationsFolder: 'src/shared/db/migrations' });
  await pool.end();
}
