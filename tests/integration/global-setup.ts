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

  // Migrations get no statement timeout: an index build on a large table would abort halfway
  // and leave __drizzle_migrations unwritten, so the retry would replay the same statement.
  const pool = new Pool({
    connectionString: urlFor(templateDatabase),
    max: 1,
    statement_timeout: 0,
  });
  await migrate(drizzle(pool), { migrationsFolder: 'src/shared/db/migrations' });
  await pool.end();
}
