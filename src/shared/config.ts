import { z } from 'zod';

// Why only these three checks beyond typing, and where the Redis URLs are
// derived instead: ADR-0003.
const env = z
  .object({
    // 3100, not the 3000 every other Node service on a developer's machine takes.
    PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
    // zod runs the refine even after the format check fails, so `new URL` here
    // would throw a TypeError carrying the password into a startup log.
    DATABASE_URL: z
      .url()
      .refine((u) => (URL.parse(u)?.pathname.length ?? 0) > 1, 'needs a database name'),
    REDIS_URL: z.url(),
    REDIS_READ_MODEL_DB: z.coerce.number().int().min(0).max(15).default(0),
    REDIS_QUEUE_DB: z.coerce.number().int().min(0).max(15).default(1),
    // How long open HTTP connections may drain before the queues are closed anyway.
    SHUTDOWN_DRAIN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
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

export const loadConfig = (source: NodeJS.ProcessEnv = process.env) => env.parse(source);
