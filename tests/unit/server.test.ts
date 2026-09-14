import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/** `src/server.ts` is excluded from coverage, and the type requires a dependency
 *  without requiring that the one passed is the live object rather than a stub. */
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

    // The client is built above the call now, because the readiness gauge needs the same
    // object; what this still has to catch is a stub reaching `createApp`, so it asserts the
    // binding is the one `createReadModelClient` produced rather than that the call is inline.
    expect(source).toContain('const products = new ProductReadRepository(');
    expect(source.slice(source.indexOf('const products ='))).toContain('createReadModelClient(');
    expect(source.slice(source.indexOf('createApp('))).toContain('products,');
  });

  it('gives the readiness gauge the same stores the app answers from', async () => {
    const source = await live();

    // A gauge built on a second pool or a second client would report the health of connections
    // no request uses, which is the failure it exists to rule out.
    expect(source).toContain('dependencyUp(new DependencyReadiness(db, products))');
  });

  it('hands createApp the real queues, so the dashboard has something to show', async () => {
    const source = await live();

    expect(source.slice(source.indexOf('createApp('))).toContain('boardQueues: queue.all()');
  });
});
