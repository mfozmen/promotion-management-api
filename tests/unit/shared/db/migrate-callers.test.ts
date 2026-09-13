import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = `${directory}/${entry.name}`;

      if (entry.isDirectory()) return sourceFiles(path);
      return entry.name.endsWith('.ts') ? [path] : [];
    }),
  );

  return files.flat();
}

// ADR-0003 gives the schema to `api` alone: one process migrates, nothing else that ships
// this image may. Prose cannot hold that, and neither can an advisory lock — the migrator
// reads the last applied row before it opens its transaction, so a second caller that loses
// the race restarts, finds the winner's timestamp, and skips its own migration reporting
// success. A lock would only make it wait politely before doing that. This fails on the
// branch that adds the second caller, which is where the alarm is worth something.
describe('runMigrations', () => {
  it('has exactly one caller in src/, because the schema belongs to the api boot alone', async () => {
    const files = await sourceFiles('src');
    const importers = await Promise.all(
      files.map(async (file) => ({
        file,
        imports: /from '.*db\/migrate\.js'/.test(await readFile(file, 'utf8')),
      })),
    );

    expect(importers.filter((entry) => entry.imports).map((entry) => entry.file)).toEqual([
      'src/server.ts',
    ]);
  });
});
