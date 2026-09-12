import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminUrl, urlFor } from './env.js';
import { sweepStaleClones } from './global-setup.js';

const HOUR_MS = 3_600_000;
const admin = new Client({ connectionString: adminUrl });
const created: string[] = [];

async function clone(ageMs: number, label: string): Promise<string> {
  const name = `pma_test_${Date.now() - ageMs}_sweep${label}`;
  await admin.query(`create database "${name}"`);
  created.push(name);
  return name;
}

async function exists(name: string): Promise<boolean> {
  const found = await admin.query('select 1 from pg_database where datname = $1', [name]);
  return found.rowCount === 1;
}

describe('stale clone sweep', () => {
  beforeAll(async () => {
    await admin.connect();
  });

  afterAll(async () => {
    for (const name of created) {
      await admin.query(`drop database if exists "${name}" with (force)`);
    }
    await admin.end();
  });

  it('drops a clone a killed run left behind', async () => {
    const abandoned = await clone(2 * HOUR_MS, 'abandoned');

    await sweepStaleClones(admin);

    expect(await exists(abandoned)).toBe(false);
  });

  it('leaves a clone young enough to belong to a run in progress alone', async () => {
    const inFlight = await clone(0, 'inflight');

    await sweepStaleClones(admin);

    expect(await exists(inFlight)).toBe(true);
  });

  it('leaves a stale clone someone still holds open alone, rather than forcing it shut', async () => {
    const held = await clone(2 * HOUR_MS, 'held');
    const holder = new Client({ connectionString: urlFor(held) });
    await holder.connect();

    try {
      await sweepStaleClones(admin);

      expect(await exists(held)).toBe(true);
    } finally {
      await holder.end();
    }
  });

  it('never considers a database that is not a clone of this harness', async () => {
    await admin.query('create database "pma_test_template_not_a_clone"');
    created.push('pma_test_template_not_a_clone');

    await sweepStaleClones(admin);

    expect(await exists('pma_test_template_not_a_clone')).toBe(true);
  });
});
