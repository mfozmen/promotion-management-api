import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@src/shared/db/migrate.js';
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

  it('is a no-op on a database already current, so every boot can call it', async () => {
    const before = await tableNames();

    await runMigrations(urlFor(database));

    expect(await tableNames()).toEqual(before);
  });

  it('rejects rather than resolving when the database cannot be reached', async () => {
    await expect(runMigrations(urlFor('pma_test_absent_database'))).rejects.toThrow();
  });
});
