import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/shared/db/schema',
  out: './src/shared/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/promotion',
  },
});
