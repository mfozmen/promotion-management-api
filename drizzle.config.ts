import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./src/modules/*/db/schema/*.ts', './src/workers/*/db/schema/*.ts'],
  out: './src/shared/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/promotion',
  },
});
