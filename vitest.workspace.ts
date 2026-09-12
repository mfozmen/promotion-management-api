import { configDefaults, defineWorkspace } from 'vitest/config';

// Two layers, so a machine with no PostgreSQL can still run `npm test` and commit.
export default defineWorkspace([
  {
    // Pure code: no store, no service, runs in the pre-commit hook. Everything outside
    // tests/integration, so a test file added anywhere else runs here rather than nowhere.
    test: {
      name: 'unit',
      include: ['tests/**/*.test.ts'],
      // Spread the defaults back in: setting `exclude` replaces them rather than adding to them.
      exclude: [...configDefaults.exclude, 'tests/integration/**'],
    },
  },
  {
    // Our code against the real store, never a mock: constraints and queries only
    // PostgreSQL enforces. Needs TEST_DATABASE_URL; CI and the pre-push agents run it.
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      globalSetup: ['tests/integration/global-setup.ts'],
      testTimeout: 30_000,
      // Both, because the database lifecycle is in beforeAll/afterAll and `testTimeout` does
      // not govern hooks. The budget is for the teardown: cloning the template is ~37 ms, but
      // `drop database` forces a cluster-wide checkpoint and fsync at ~620 ms each, once per
      // file. Six files spend ~3.7 s of it; past roughly a dozen, run the throwaway server
      // with `fsync=off` rather than raising this again.
      hookTimeout: 30_000,
    },
  },
]);
