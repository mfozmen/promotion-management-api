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
      // Process entry points, per the design spec's section 12: they wire collaborators and
      // install signal handlers, and exercising them means starting a process.
      // `sonar-project.properties` repeats the list because SonarCloud reads its own.
      exclude: [
        'src/server.ts',
        'src/workers/event-handler.ts',
        'src/workers/ingestion-worker.ts',
        'src/workers/reconciler.ts',
        '**/*.d.ts',
      ],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
