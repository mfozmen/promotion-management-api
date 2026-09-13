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

// ADR-0003 gives the schema to the `api` boot alone. This fails on the branch that adds a
// second caller, which is where the alarm is worth something — including a side-effect
// import, which is a caller the moment the module runs.
describe('runMigrations', () => {
  it('has exactly one caller in src/, because the schema belongs to the api boot alone', async () => {
    const files = await sourceFiles('src');
    const importers = await Promise.all(
      files.map(async (file) => ({
        file,
        imports: /import\s+(?:.*\sfrom\s+)?'[^']*db\/migrate\.js'/.test(
          await readFile(file, 'utf8'),
        ),
      })),
    );

    expect(importers.filter((entry) => entry.imports).map((entry) => entry.file)).toEqual([
      'src/server.ts',
    ]);
  });
});
