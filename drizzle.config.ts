import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // Every module owns its tables (REVIEW.md 8c.10); the migrations stay in one place
  // because one journal and one api own them.
  schema: ['./src/modules/*/db/schema/*.ts', './src/workers/*/db/schema/*.ts'],
  out: './src/shared/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/promotion',
  },
});
