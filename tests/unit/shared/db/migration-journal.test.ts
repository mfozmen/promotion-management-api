import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '@src/shared/db/migrate.js';

type Entry = { idx: number; when: number; tag: string };
type Journal = { entries: Entry[] };

const JOURNAL = `${MIGRATIONS_FOLDER}/meta/_journal.json`;

async function journal(): Promise<Journal> {
  return JSON.parse(await readFile(JOURNAL, 'utf8')) as Journal;
}

// The ref must resolve or this fails: a guard that quietly does not run is
// indistinguishable from one that passed, which is how three gates got past us this week.
// A ref that resolves but carries no journal is a different answer, and an honest one —
// before the first migrations land there is nothing deployed to protect.
function journalOnMain(): Journal {
  const ref = ['origin/main', 'main'].find((candidate) => {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', candidate], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });

  if (ref === undefined) {
    throw new Error('neither origin/main nor main resolves; fetch main before running');
  }

  try {
    return JSON.parse(execFileSync('git', ['show', `${ref}:${JOURNAL}`], { encoding: 'utf8' }));
  } catch {
    return { entries: [] };
  }
}

// The migrator applies every journal entry whose `when` is greater than the single most
// recently applied row, and never compares the hash it stores. So an entry that arrives
// carrying a timestamp a deployed database has already passed is skipped there for ever,
// while the boot reports success. That is a property of this branch against main, not of
// the file alone: sorting a conflicted journal by `when` leaves it internally tidy and
// still skips the later migration everywhere it is already deployed.
describe('the migration journal', () => {
  it('adds entries after everything main already carries, never between them', async () => {
    const { entries } = await journal();
    const onMain = journalOnMain().entries;
    const highestOnMain = Math.max(0, ...onMain.map((entry) => entry.when));

    for (const entry of entries.slice(onMain.length)) {
      expect(entry.when).toBeGreaterThan(highestOnMain);
    }
  });

  it('leaves the entries main carries exactly as they are', async () => {
    const { entries } = await journal();

    expect(entries.slice(0, journalOnMain().entries.length)).toEqual(journalOnMain().entries);
  });

  it('orders entries by the timestamp the migrator compares, and never repeats one', async () => {
    const timestamps = (await journal()).entries.map((entry) => entry.when);

    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    expect(new Set(timestamps).size).toBe(timestamps.length);
  });
});
