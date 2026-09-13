import { glob, readFile, stat } from 'node:fs/promises';
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
  [
    'src/middleware/',
    'the directory the HTTP boundary was moved out of, named by ADR-0009 as what it replaced',
  ],
  [
    'src/shared/safe-request-id.ts',
    'where ADR-0010 sends the correlation-id pattern when a second caller needs it, so the move is decided rather than improvised',
  ],
  ['src/shared/db/schema/', 'where the table schemas were before they moved into their modules'],
  ['src/modules/vendor/', 'a module the agent triggers name before it is written'],
]);

/** `Foo.bar` or `Foo.bar(args)` in a document: a member of one of our own declarations. */
const MEMBER = /`([A-Z][A-Za-z0-9]*)\.([a-zA-Z][A-Za-z0-9_]*)(?:\([^`]*\))?`/g;

/** An `ADR-00NN` citation anywhere in the documents. */
const CITATION = /\bADR-(\d{4})\b/g;

function wholeWord(name: string): RegExp {
  return new RegExp(`\\b${name}\\b`);
}

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

/**
 * Where each exported declaration lives. A name the tree does not export is not ours —
 * `JSON.parse` and `Promise.all` fall out here rather than needing an exemption.
 */
async function exportedDeclarations(): Promise<Map<string, string>> {
  const found = new Map<string, string>();

  for await (const file of glob('src/**/*.ts')) {
    const text = await readFile(file, 'utf8');
    for (const [, name] of text.matchAll(
      /export (?:abstract )?(?:class|const|function|type|interface) ([A-Za-z_$][\w$]*)/g,
    )) {
      // Two modules may export the same name by design, and a map would keep whichever
      // the glob yielded last; a member found in either file is the honest answer.
      if (name) found.set(name, (found.get(name) ?? '') + text);
    }
  }
  return found;
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

  it('name only members their declaration actually has', async () => {
    // A rename is reliable in the code and unreliable in the prose about it.
    const declarations = await exportedDeclarations();
    const missing: string[] = [];

    for (const document of DOCUMENTS) {
      const text = await readFile(document, 'utf8');
      for (const [, owner, member] of text.matchAll(MEMBER)) {
        const source = owner === undefined ? undefined : declarations.get(owner);
        // A whole word: `includes` stayed green on `connect` because of `connectTimeout`.
        // ponytail: a match in a comment counts too; parsing the file is the upgrade.
        if (source !== undefined && member !== undefined && !wholeWord(member).test(source)) {
          missing.push(`${document}: ${owner}.${member}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('cite only ADRs that exist', async () => {
    // A renumber leaves every citation pointing one record off, and each one still reads
    // like a valid reference.
    const records = new Set(
      [...(await readFile('ADR.md', 'utf8')).matchAll(/^## ADR-(\d{4}):/gm)].map(([, n]) => n),
    );
    const dangling: string[] = [];

    for (const document of DOCUMENTS) {
      const text = await readFile(document, 'utf8');
      for (const [, number] of text.matchAll(CITATION)) {
        if (number !== undefined && !records.has(number))
          dangling.push(`${document}: ADR-${number}`);
      }
    }

    expect({ records: records.size > 0, dangling }).toEqual({ records: true, dangling: [] });
  });

  it('checks enough names and citations that an empty pattern could not pass', async () => {
    const declarations = await exportedDeclarations();
    let members = 0;
    let citations = 0;

    for (const document of DOCUMENTS) {
      const text = await readFile(document, 'utf8');
      members += [...text.matchAll(MEMBER)].filter(([, owner]) =>
        owner === undefined ? false : declarations.has(owner),
      ).length;
      citations += [...text.matchAll(CITATION)].length;
    }

    expect({ members: members > 5, citations: citations > 20 }).toEqual({
      members: true,
      citations: true,
    });
  });

  it('keeps every exemption earned: a path that exists again needs no excuse', async () => {
    const stillAbsent = [];

    for (const path of NAMED_BUT_ABSENT.keys()) {
      if (!(await exists(path))) stillAbsent.push(path);
    }

    expect(stillAbsent).toEqual([...NAMED_BUT_ABSENT.keys()]);
  });
});
