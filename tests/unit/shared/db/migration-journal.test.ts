import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '@src/shared/db/migrate.js';

type Journal = { entries: { idx: number; when: number; tag: string }[] };

async function journal(): Promise<Journal> {
  return JSON.parse(await readFile(`${MIGRATIONS_FOLDER}/meta/_journal.json`, 'utf8')) as Journal;
}

// The migrator reads the single most recently applied row and applies every entry whose
// `when` is greater; it never compares the hash it stores. So an entry generated before one
// that merged ahead of it is skipped on every database that already applied the other, for
// ever, while the boot reports success. The condition for that is visible here and nowhere
// else: it is a property of the journal at merge time, not of any database. Asserting the
// applied count against a freshly migrated database cannot catch it — there the timestamps
// are increasing by construction and the assertion passes whatever the order.
describe('the migration journal', () => {
  it('orders entries by the timestamp the migrator compares, not only by index', async () => {
    const { entries } = await journal();
    const timestamps = entries.map((entry) => entry.when);

    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    expect(new Set(timestamps).size).toBe(timestamps.length);
  });

  it('numbers entries consecutively from zero, so the file order is the apply order', async () => {
    const { entries } = await journal();

    expect(entries.map((entry) => entry.idx)).toEqual(entries.map((_entry, index) => index));
  });
});
