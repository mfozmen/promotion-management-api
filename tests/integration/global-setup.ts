import { Client } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, createPool } from '../../src/shared/db/client.js';
import { adminUrl, templateDatabase, urlFor } from './env.js';

export default async function setup(): Promise<void> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${templateDatabase} with (force)`);
  await admin.query(`create database ${templateDatabase}`);
  await admin.end();

  const pool = createPool(urlFor(templateDatabase));
  await migrate(createDb(pool), { migrationsFolder: 'src/shared/db/migrations' });
  await pool.end();
}
