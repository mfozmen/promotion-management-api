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
      testTimeout: 30_000, // creating and cloning databases is seconds, not milliseconds
    },
  },
]);
