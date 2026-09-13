import { readFile } from 'node:fs/promises';
import { createPool } from '../src/shared/db/client.js';

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined) {
  throw new Error('DATABASE_URL is not set; copy .env.example to .env and export it');
}

// One `query` call, so the file's statements travel as a single simple query and PostgreSQL
// wraps them in one implicit transaction.
const statements = await readFile(new URL('./demo-seed.sql', import.meta.url), 'utf8');
const pool = createPool(connectionString);

try {
  await pool.query(statements);
  console.log('Demo catalogue and flash sale seeded.');
} finally {
  await pool.end();
}
