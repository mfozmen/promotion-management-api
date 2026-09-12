import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { adminUrl, templateDatabase, urlFor } from './env.js';

export default async function setup(): Promise<void> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  // A killed run cannot drop its clone, so sweep whatever the last one left behind.
  const orphans = await admin.query<{ datname: string }>(
    `select datname from pg_database where datname like 'pma_test%'`,
  );
  for (const { datname } of orphans.rows) {
    await admin.query(`drop database if exists "${datname}" with (force)`);
  }
  await admin.query(`drop database if exists ${templateDatabase} with (force)`);
  await admin.query(`create database ${templateDatabase}`);
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
