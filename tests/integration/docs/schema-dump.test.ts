import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloneName, templateDatabase, urlFor } from '../env.js';
import { onAdmin } from '../db.js';

/**
 * Every object the two databases must agree on, as one sorted list of strings. Read from the
 * catalog rather than diffed as text: two `pg_dump` runs of the same schema already differ on
 * the `\restrict` token they open and close with, and a check that fails on every unchanged run
 * is switched off within a week.
 */
const FACTS = `
  select 'column ' || table_name || '.' || column_name || ' ' || data_type || ' ' || udt_name
         || ' null=' || is_nullable || ' default=' || coalesce(column_default, '-') as fact
  from information_schema.columns where table_schema = 'public'
  union all
  select 'enum ' || t.typname || ' ' || e.enumsortorder || ' ' || e.enumlabel
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typnamespace = 'public'::regnamespace
  union all
  select 'index ' || indexdef from pg_indexes where schemaname = 'public'
  union all
  select 'constraint ' || conrelid::regclass::text || ' ' || pg_get_constraintdef(oid)
  from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'trigger ' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal
  union all
  select 'function ' || pg_get_functiondef(p.oid) from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  select 'view ' || viewname || ' ' || definition from pg_views where schemaname = 'public'
  union all
  select 'extension ' || extname from pg_extension
  order by 1
`;

async function on<T>(database: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: urlFor(database) });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function factsOf(database: string): Promise<string[]> {
  return on(database, async (client) => {
    const { rows } = await client.query<{ fact: string }>(FACTS);

    return rows.map((row) => row.fact);
  });
}

const fromMigrations = cloneName();
const fromFile = cloneName();

beforeAll(async () => {
  await onAdmin(`create database "${fromMigrations}" template "${templateDatabase}"`);
  await onAdmin(`create database "${fromFile}"`);
  const file = await readFile(new URL('../../../docs/schema.sql', import.meta.url), 'utf8');

  // `\restrict` and `\unrestrict` are psql meta-commands, not SQL, and the only two lines of the
  // file a server cannot execute. Dropping them is the whole normalisation: anything else
  // dropped here would be a difference this test stops seeing.
  await on(fromFile, (client) =>
    client.query(
      file
        .split('\n')
        .filter((line) => !line.startsWith('\\'))
        .join('\n'),
    ),
  );
});

afterAll(async () => {
  for (const database of [fromMigrations, fromFile]) {
    await onAdmin(`drop database if exists "${database}" with (force)`);
  }
});

describe('docs/schema.sql', () => {
  it('builds the same schema the migrations do, object for object', async () => {
    // The DDL is the first row of the README's submission table and nothing else in this
    // repository reads the file, so the next migration that lands without it being regenerated
    // makes the deliverable quietly wrong (issue #133).
    const [migrated, committed] = await Promise.all([factsOf(fromMigrations), factsOf(fromFile)]);

    expect(committed).toEqual(migrated);
    // The comparison is only worth something if both sides found the schema: two empty lists
    // are equal, and a query that silently matched nothing would pass for ever.
    expect(committed.length).toBeGreaterThan(50);
  });
});
