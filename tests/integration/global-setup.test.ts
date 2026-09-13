import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminUrl, urlFor } from './env.js';
import { sweepStaleClones } from './global-setup.js';

const HOUR_MS = 3_600_000;
// Fixtures of our own, under a prefix unique to this run: a real `pma_test_` clone would be
// fair game for a sibling worktree's sweep between creating it and holding it open, and a
// fixed fixture prefix would only move that collision rather than remove it.
// Eight hex digits, not a whole uuid: PostgreSQL truncates a database name at 63 bytes, and
// the name still has to carry the fixture's timestamp and label after this prefix.
// These fixtures sit outside the production sweep's namespace, so a crashed run
// leaks its four databases for ever. Bounded and on a throwaway server; fold them back into
// `pma_test_<epoch>_` if it ever bites.
const RUN = randomUUID().replaceAll('-', '').slice(0, 8);
const PREFIX = `pma_sweepfix_${RUN}_`;
const PATTERN = `^${PREFIX}([0-9]+)_`;
const admin = new Client({ connectionString: adminUrl });
const created: string[] = [];

async function clone(ageMs: number, label: string): Promise<string> {
  const name = `${PREFIX}${Date.now() - ageMs}_${label}`;
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

    await sweepStaleClones(admin, { pattern: PATTERN });

    expect(await exists(abandoned)).toBe(false);
  });

  it('leaves a clone young enough to belong to a run in progress alone', async () => {
    const inFlight = await clone(0, 'inflight');

    await sweepStaleClones(admin, { pattern: PATTERN });

    expect(await exists(inFlight)).toBe(true);
  });

  it('leaves a stale clone someone still holds open alone, rather than forcing it shut', async () => {
    const held = await clone(2 * HOUR_MS, 'held');
    const holder = new Client({ connectionString: urlFor(held) });
    await holder.connect();

    try {
      await sweepStaleClones(admin, { pattern: PATTERN });

      expect(await exists(held)).toBe(true);
    } finally {
      await holder.end();
    }
  });

  it('never considers a database that is not a clone of this harness', async () => {
    const notAClone = `${PREFIX}template_not_a_clone`;
    await admin.query(`create database "${notAClone}"`);
    created.push(notAClone);

    await sweepStaleClones(admin, { pattern: PATTERN });

    expect(await exists(notAClone)).toBe(true);
  });
});
