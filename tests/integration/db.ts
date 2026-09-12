import { randomUUID } from 'node:crypto';
import { Client, type Pool } from 'pg';
import { afterAll, beforeAll } from 'vitest';
import { createDb, createPool, type Db } from '../../src/shared/db/client.js';
import { adminUrl, templateDatabase, urlFor } from './env.js';

async function onAdmin(statement: string): Promise<void> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(statement);
  } finally {
    await admin.end();
  }
}

// Cloning the migrated template per file is what keeps files isolated under parallel runs.
export function useTestDatabase(): () => Db {
  const name = `pma_test_${randomUUID().replaceAll('-', '')}`;
  let pool: Pool;
  let db: Db;

  beforeAll(async () => {
    await onAdmin(`create database ${name} template ${templateDatabase}`);
    pool = createPool(urlFor(name));
    db = createDb(pool);
  });

  afterAll(async () => {
    await pool.end();
    await onAdmin(`drop database if exists ${name} with (force)`);
  });

  return () => db;
}

export async function sqlStateOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    let current: unknown = error;
    while (current instanceof Error) {
      const { code } = current as { code?: string };
      if (typeof code === 'string') return code;
      current = current.cause;
    }
    return undefined;
  }
}
