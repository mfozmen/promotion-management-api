import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

// `server.ts` is excluded from coverage (7.2), so nothing else would notice.
describe('the process entry point', () => {
  it('hands createApp a real read-model client, which a merge once dropped', async () => {
    const server = await readFile('src/server.ts', 'utf8');

    // The type stops an app built without a repository from compiling; it does not
    // stop a real client being forgotten and something else handed over. Taking
    // main's `server.ts` whole in a merge deleted this line, every test stayed
    // green, and the deployed process answered 404 on every storefront route.
    // Matched from `createApp(` to the end of the file rather than with a bounded
    // pattern: the call spans several arguments now, and `[^)]*` stopped at the
    // first of them.
    const call = server.slice(server.indexOf('createApp('));

    expect(call).toContain('createReadModelClient(');
  });
});
