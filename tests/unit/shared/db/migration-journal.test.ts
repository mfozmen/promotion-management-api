import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '@src/shared/db/migrate.js';

type Entry = { idx: number; when: number; tag: string };

async function entries(): Promise<Entry[]> {
  const journal = JSON.parse(await readFile(`${MIGRATIONS_FOLDER}/meta/_journal.json`, 'utf8')) as {
    entries: Entry[];
  };

  return journal.entries;
}

// Two entries sharing a timestamp lose one silently, and file order disagreeing with
// timestamp order applies them in an order nobody wrote down. That is all one file can
// answer; the half that matters on merge is the `ci` comparison against the base ref.
// ADR-0003 and REVIEW.md 11.5.
describe('the migration journal', () => {
  it('orders entries by the timestamp the migrator compares, and never repeats one', async () => {
    const timestamps = (await entries()).map((entry) => entry.when);

    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    expect(new Set(timestamps).size).toBe(timestamps.length);
  });

  it('numbers entries consecutively from zero, so the file order is the apply order', async () => {
    const journal = await entries();

    expect(journal.map((entry) => entry.idx)).toEqual(journal.map((_entry, index) => index));
  });
});
