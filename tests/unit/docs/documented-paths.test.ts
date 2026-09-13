import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const DOCUMENTS = [
  'ADR.md',
  'README.md',
  'CONTRIBUTING.md',
  'REVIEW.md',
  'CLAUDE.md',
  'docs/superpowers/specs/2026-09-12-domain-design.md',
  'docs/superpowers/specs/2026-09-12-infrastructure-design.md',
  '.claude/agents/architecture-critic.md',
  '.claude/agents/docs-scribe.md',
  '.claude/agents/e2e-tester.md',
  '.claude/agents/impact-analyzer.md',
  '.claude/agents/test-case-generator.md',
];
const ROOTS = ['src/', 'tests/', 'docs/', '.claude/', '.github/'];

const BACKTICKED = /`([^`\s]+)`/g;

/** Paths a document names on purpose without claiming they exist; each needs a reason. */
const NAMED_BUT_ABSENT = new Map([
  ['tests/e2e', 'a layer the layout rule reserves; no such test is written yet'],
  [
    'src/middleware/validate.ts',
    'evidence of a name that reads as an instruction, never a file here',
  ],
  ['src/shared/db/schema/', 'where the table schemas were before they moved into their modules'],
  ['src/modules/vendor/', 'a module the agent triggers name before it is written'],
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
