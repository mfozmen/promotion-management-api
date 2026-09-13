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

// The migrator applies every entry whose `when` is greater than the single most recently
// applied row, and never compares the hash it stores. Two entries with the same timestamp
// therefore lose one silently, and file order that disagrees with timestamp order applies
// them in an order nobody wrote down. Both are visible in the file itself.
//
// The other half of the hazard is not: an entry sorted into the middle of the journal on
// merge is skipped for ever on databases that already passed that timestamp, and no
// assertion over one file can see it, because the file looks perfectly ordered afterwards.
// That comparison is against the base branch and lives in the CI workflow, where the refs
// are, and in REVIEW.md 11.5.
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
