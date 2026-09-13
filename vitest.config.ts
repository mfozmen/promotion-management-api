import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@src': fileURLToPath(new URL('./src', import.meta.url)),
      '@tests': fileURLToPath(new URL('./tests', import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**'],
      // Entry points: wiring, and nothing a test can hold. Everything they decide
      // lives in a class they call — `ChunkJobHandler` carries the worker's
      // concurrency and lock duration for exactly that reason, because the last
      // thing excluded here shipped a 404 for every route in production.
      exclude: ['src/server.ts', 'src/workers/ingestion-worker.ts', '**/*.d.ts'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
