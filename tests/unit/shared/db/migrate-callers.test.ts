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

// ADR-0003: only the api boot migrates; this fails on the branch that adds a second caller.
describe('runMigrations', () => {
  it('has exactly one caller in src/, because the schema belongs to the api boot alone', async () => {
    const files = await sourceFiles('src');
    const importers = await Promise.all(
      files.map(async (file) => ({
        file,
        // import( and export … from are callers too.
        imports: /(?:import|export)[\s(][^'"]*['"][^'"]*db\/migrate\.js['"]/.test(
          await readFile(file, 'utf8'),
        ),
      })),
    );

    expect(importers.filter((entry) => entry.imports).map((entry) => entry.file)).toEqual([
      'src/server.ts',
    ]);
  });
});
