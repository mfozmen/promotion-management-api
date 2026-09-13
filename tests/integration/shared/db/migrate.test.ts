import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, runMigrations } from '@src/shared/db/migrate.js';
import { adminUrl, cloneName, urlFor } from '../../env.js';

// Not the cloned template every other file uses: this is the one test that needs an
// unmigrated database, because what it asserts is what the api entrypoint does to one.
const database = cloneName();

async function onAdmin(statement: string): Promise<void> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(statement);
  } finally {
    await admin.end();
  }
}

async function tableNames(): Promise<string[]> {
  const client = new Client({ connectionString: urlFor(database) });
  await client.connect();
  try {
    const { rows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    return rows.map((row) => row.table_name);
  } finally {
    await client.end();
  }
}

describe('runMigrations', () => {
  beforeAll(async () => {
    await onAdmin(`create database "${database}"`);
  });

  afterAll(async () => {
    await onAdmin(`drop database if exists "${database}" with (force)`);
  });

  it('brings an empty database up to the current schema', async () => {
    await expect(tableNames()).resolves.toEqual([]);

    await runMigrations(urlFor(database));

    expect(await tableNames()).toEqual(
      expect.arrayContaining(['products', 'promotions', 'pricing_rules']),
    );
  });

  // The migrator takes the single most recently applied row and applies every journal entry
  // with a later timestamp; it never compares the hash it stores. So a migration merged out
  // of order — generated before a sibling that merged first — is skipped silently, on this
  // boot and every boot after, while `up --wait` still reports success. Counting is what
  // catches it: a skipped migration is a missing row.
  it('applies every migration in the journal, not only those after the newest applied one', async () => {
    const journal = JSON.parse(
      await readFile(`${MIGRATIONS_FOLDER}/meta/_journal.json`, 'utf8'),
    ) as { entries: unknown[] };
    const client = new Client({ connectionString: urlFor(database) });
    await client.connect();

    try {
      const { rows } = await client.query<{ count: string }>(
        'select count(*)::int as count from drizzle.__drizzle_migrations',
      );

      expect(Number(rows[0]?.count)).toBe(journal.entries.length);
    } finally {
      await client.end();
    }
  });

  it('is a no-op on a database already current, so every boot can call it', async () => {
    const before = await tableNames();

    await runMigrations(urlFor(database));

    expect(await tableNames()).toEqual(before);
  });

  it('rejects rather than resolving when the database cannot be reached', async () => {
    await expect(runMigrations(urlFor('pma_test_absent_database'))).rejects.toThrow();
  });
});
