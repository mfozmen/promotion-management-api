import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

// `src/server.ts` is the one file coverage excludes, so nothing else here can notice a route
// that is mounted only by tests. This branch shipped exactly that: `createApp()` with no
// reporter, a documented admin endpoint, and 288 green tests over an endpoint no deployment
// served. The guard is textual because the alternative is running the boot.
describe('server.ts', () => {
  it('builds the app with the queue reporter, so the admin route is served and not just tested', async () => {
    const source = await readFile('src/server.ts', 'utf8');
    // Line comments go first: a plain match cannot tell a live call from one commented out
    // above a stub, which is the shape a "disable this for now" commit takes. Matching the
    // wrapped call rather than a whole line, because prettier decides where it breaks.
    const live = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');

    expect(live).toMatch(/const app = createApp\(\s*logger,\s*new QueueStatsReporter\(/);
  });
});
