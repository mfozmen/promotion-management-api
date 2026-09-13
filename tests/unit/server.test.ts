import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/**
 * `src/server.ts` is the one file coverage excludes, so nothing else in the suite can
 * notice a collaborator that is wired only in tests. The type requires each dependency;
 * it cannot require that the one passed is the live object rather than a stub, and both
 * of these have already happened here — a merge took main's `server.ts` whole and dropped
 * the read-model client, and this branch shipped a documented admin endpoint that no
 * deployment served. The guards are textual because the alternative is running the boot.
 */
const live = async (): Promise<string> =>
  (await readFile('src/server.ts', 'utf8'))
    // Comments go first, block and line: a plain match cannot tell a live call from one
    // commented out above a stub, which is the shape a "disable this for now" commit takes.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

describe('server.ts', () => {
  it('hands createApp a real read-model client', async () => {
    const source = await live();

    // Sliced from `createApp(` to the end rather than matched with a bounded pattern:
    // the call spans six arguments, and `[^)]*` stopped at the first of them.
    expect(source.slice(source.indexOf('createApp('))).toContain('createReadModelClient(');
  });

  it('hands createApp the real queues, so the dashboard has something to show', async () => {
    const source = await live();

    expect(source.slice(source.indexOf('createApp('))).toMatch(/queues:\s*queue\b/);
  });
});
