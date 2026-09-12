import { z } from 'zod';

// Only the failures that would otherwise surface late and quietly are checked
// beyond typing: a DATABASE_URL without a database name (node-postgres silently
// connects to a fallback), the read model and the queue on the same Redis
// logical database (a read-model rebuild would UNLINK queued jobs), and a lease
// below the budget (a healthy chunk loses its claim). Everything else fails on
// its own at first use. The two Redis URLs are derived where a connection is
// opened, not here.
const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z.url().refine((u) => new URL(u).pathname.length > 1, 'needs a database name'),
    REDIS_URL: z.url(),
    REDIS_READ_MODEL_DB: z.coerce.number().int().min(0).max(15).default(0),
    REDIS_QUEUE_DB: z.coerce.number().int().min(0).max(15).default(1),
    UPLOAD_DIR: z.string().default('./uploads'),
    INGESTION_CHUNK_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(4 * 1024 * 1024),
    INGESTION_BATCH_SIZE: z.coerce.number().int().min(1).max(5000).default(1000),
    INGESTION_BUDGET_MS: z.coerce.number().int().positive().default(60_000),
    INGESTION_LEASE_MS: z.coerce.number().int().positive().default(90_000),
    INGESTION_MAX_FAILURES: z.coerce.number().int().positive().default(3),
    INGESTION_MAX_WAITING: z.coerce.number().int().positive().default(100),
  })
  .refine((e) => e.REDIS_READ_MODEL_DB !== e.REDIS_QUEUE_DB, {
    message: 'read model and queue must use different Redis databases',
    path: ['REDIS_QUEUE_DB'],
  })
  .refine((e) => e.INGESTION_LEASE_MS >= e.INGESTION_BUDGET_MS, {
    message: 'INGESTION_LEASE_MS must be at least INGESTION_BUDGET_MS',
    path: ['INGESTION_LEASE_MS'],
  });

export type Config = z.infer<typeof env>;

export const loadConfig = (source: NodeJS.ProcessEnv = process.env): Config => env.parse(source);
