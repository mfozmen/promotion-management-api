import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const DOCUMENTS = ['ADR.md', 'README.md', 'CONTRIBUTING.md', 'REVIEW.md'];
const ROOTS = ['src/', 'tests/', 'docs/', '.claude/', '.github/'];

const BACKTICKED = /`([^`\s]+)`/g;

/**
 * Paths a document names on purpose without claiming they exist. Each needs a reason, and
 * the list staying short is the signal: a long one means the check has stopped meaning
 * anything.
 */
const NAMED_BUT_ABSENT = new Map([
  ['tests/e2e', 'a layer the layout rule reserves; no such test is written yet'],
  [
    'src/middleware/validate.ts',
    'evidence of a name that reads as an instruction, never a file here',
  ],
  ['src/shared/db/schema/', 'where the table schemas were before they moved into their modules'],
]);

function isTemplate(path: string): boolean {
  return path.includes('*') || path.includes('<') || path.includes('{');
}

async function documentedPaths(document: string): Promise<string[]> {
  const text = await readFile(document, 'utf8');
  const found = [...text.matchAll(BACKTICKED)].flatMap(([, path]) => (path ? [path] : []));

  return [...new Set(found)].filter(
    (path) =>
      ROOTS.some((root) => path.startsWith(root)) &&
      !isTemplate(path) &&
      !NAMED_BUT_ABSENT.has(path),
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Every stale path found this week described structure rather than behaviour — a renamed
// class, a moved file, a deleted barrel — so the suite stayed green through all of them, and
// two careful readings passed over the same four. Testing each path against the tree found
// them at once.
describe('the documents', () => {
  it.each(DOCUMENTS)('name only paths that exist, in %s', async (document) => {
    const missing: string[] = [];

    for (const path of await documentedPaths(document)) {
      if (!(await exists(path))) missing.push(path);
    }

    expect({ document, missing }).toEqual({ document, missing: [] });
  });

  it('checks enough paths that an empty pattern could not pass', async () => {
    const counted = await Promise.all(DOCUMENTS.map(documentedPaths));

    expect(counted.flat().length).toBeGreaterThan(40);
  });

  it('keeps every exemption earned: a path that exists again needs no excuse', async () => {
    const stillAbsent = [];

    for (const path of NAMED_BUT_ABSENT.keys()) {
      if (!(await exists(path))) stillAbsent.push(path);
    }

    expect(stillAbsent).toEqual([...NAMED_BUT_ABSENT.keys()]);
  });
});
