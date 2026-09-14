import { Client } from 'pg';
import { runMigrations } from '@src/shared/db/migrate.js';
import { adminUrl, templateDatabase, urlFor } from './env.js';

const STALE_AFTER_MS = 3_600_000;
const CLONE_PATTERN = '^pma_test_([0-9]+)_';

/**
 * A killed run cannot drop its clone, so abandoned ones are swept here. Scoped by age and
 * never forced: a dozen worktrees share this server under the same name prefix, so a clone
 * younger than an hour, or one another process still holds open, belongs to a run in
 * progress. A `like` is not ownership.
 *
 * `pattern` exists so the test can sweep fixtures of its own rather than real clones; there
 * is one production value and it is the default.
 */
export async function sweepStaleClones(
  admin: Client,
  { pattern = CLONE_PATTERN }: { pattern?: string } = {},
): Promise<void> {
  // `substring` rather than a `~` test plus `split_part(...)::bigint`: PostgreSQL orders
  // qualifiers by cost, not left to right, so the cast could run on a name the regex was
  // meant to exclude and raise 22P02. A non-match yields NULL here, which filters out.
  const stale = await admin.query<{ datname: string }>(
    `select datname from pg_database where (substring(datname from $2))::bigint < $1`,
    [Date.now() - STALE_AFTER_MS, pattern],
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
  } catch (error) {
    // The driver's own words, because this guard cannot tell why the connect
    // failed and its message used to claim it could. A missing database answers
    // `3D000` from a server that is running and reachable, and was reported here
    // as an unreachable server — which sends the reader to the ports, where
    // nothing is wrong. Say what happened, then what usually causes it.
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `cannot use PostgreSQL at ${adminUrl}: ${cause}. The server, the port and the database are three separate failures; start the test stores with 'npm run up', or point TEST_DATABASE_URL at a database that exists.`,
      { cause: error },
    );
  }
  await sweepStaleClones(admin);
  // Named after this checkout, so rebuilding the template races no other worktree.
  await admin.query(`drop database if exists "${templateDatabase}" with (force)`);
  await admin.query(`create database "${templateDatabase}"`);
  await admin.end();

  // Through the same function the api entrypoint calls, so the harness that proves the
  // schema cannot drift from what production runs.
  await runMigrations(urlFor(templateDatabase));
}
