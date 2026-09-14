import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, migrationPool, runMigrations } from '@src/shared/db/migrate.js';
import { cloneName, urlFor } from '../../env.js';
import { onAdmin } from '../../db.js';

// Not the cloned template every other file uses: this is the one test that needs an
// unmigrated database, because what it asserts is what the api entrypoint does to one.
const database = cloneName();

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

  // Every journal entry left a row, so nothing in this set was skipped. It is the weaker
  // half of the guard and cannot fail while the journal is ordered — the condition that
  // makes the migrator skip is asserted in tests/unit/shared/db/migration-journal.test.ts,
  // where it is visible.
  it('records one row per journal entry', async () => {
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

  // Against the pool the migrator itself opens, not one this test configured: the point is
  // whether the `set` on connect reaches the wire before the first statement, and a test
  // that sets the value itself would pass over a line that does nothing.
  it('migrates on a session that bounds the wait for a lock and not the work', async () => {
    const pool = migrationPool(urlFor(database));

    try {
      const { rows } = await pool.query<{ lock: string; statement: string }>(
        'select current_setting($1) as lock, current_setting($2) as statement',
        ['lock_timeout', 'statement_timeout'],
      );

      expect(rows[0]?.lock).toBe('10s');
      expect(rows[0]?.statement).toBe('0');
    } finally {
      await pool.end();
    }
  });

  it('rejects rather than resolving when the database cannot be reached', async () => {
    await expect(runMigrations(urlFor('pma_test_absent_database'))).rejects.toThrow();
  });
});
