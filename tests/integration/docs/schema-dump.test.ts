import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloneName, templateDatabase, urlFor } from '../env.js';
import { onAdmin } from '../db.js';

/** What the two databases must agree on; why it is the catalog and not the text, and why a
 *  column carries its modifiers, is in `docs/data-model.md`. */
const FACTS = `
  select 'column ' || table_name || '.' || ordinal_position || ' ' || column_name || ' '
         || data_type || ' ' || udt_name
         || '(' || coalesce(character_maximum_length::text, '') || ','
         || coalesce(numeric_precision::text, '') || ',' || coalesce(numeric_scale::text, '')
         || ',' || coalesce(datetime_precision::text, '') || ')'
         || ' collation=' || coalesce(collation_name, '-')
         || ' null=' || is_nullable || ' default=' || coalesce(column_default, '-')
         || ' identity=' || is_identity || coalesce(identity_generation, '') as fact
  from information_schema.columns where table_schema = 'public'
  union all
  select 'sequence ' || sequencename || ' ' || data_type || ' start=' || start_value
         || ' increment=' || increment_by || ' min=' || min_value || ' max=' || max_value
         || ' cycle=' || cycle || ' cache=' || cache_size
  from pg_sequences where schemaname = 'public'
  union all
  select 'rls ' || relname || ' ' || relrowsecurity || ' ' || relforcerowsecurity
         || ' options=' || coalesce(array_to_string(reloptions, ','), '-')
  from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p')
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

  // The psql meta-commands, which a server cannot execute. Anything else dropped here would be
  // a difference this test stops seeing.
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
  // `allSettled`, so a failure dropping the first still drops the second; awaited in sequence,
  // the pair that a half-built `beforeAll` leaves behind would be half-cleaned.
  await Promise.allSettled(
    [fromMigrations, fromFile].map((database) =>
      onAdmin(`drop database if exists "${database}" with (force)`),
    ),
  );
});

describe('docs/schema.sql', () => {
  it('builds the same schema the migrations do, object for object', async () => {
    const [migrated, committed] = await Promise.all([factsOf(fromMigrations), factsOf(fromFile)]);

    expect(committed).toEqual(migrated);
    // A floor, not a count: two empty lists are equal, so a query that matched nothing would
    // pass for ever.
    expect(committed.length).toBeGreaterThan(50);
  });
});
