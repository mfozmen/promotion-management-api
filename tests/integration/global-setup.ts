import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { adminUrl, templateDatabase, urlFor } from './env.js';

export default async function setup(): Promise<void> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
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
