import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

// `server.ts` is excluded from coverage (7.2), so nothing else would notice.
describe('the process entry point', () => {
  it('hands createApp a real read-model client, which a merge once dropped', async () => {
    const server = await readFile('src/server.ts', 'utf8');

    // The type stops an app built without a repository; it does not stop a real
    // client being forgotten and a stub handed over, which a merge once did.
    const call = server.slice(server.indexOf('createApp('));

    expect(call).toContain('createReadModelClient(');
  });
});
