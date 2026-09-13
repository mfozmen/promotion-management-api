import { z } from 'zod';

const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
    // `new URL` here would throw on a malformed value, carrying the password into a log.
    DATABASE_URL: z
      .url()
      .refine((u) => (URL.parse(u)?.pathname.length ?? 0) > 1, 'needs a database name'),
    REDIS_URL: z.url(),
    REDIS_READ_MODEL_DB: z.coerce.number().int().min(0).max(15).default(0),
    REDIS_QUEUE_DB: z.coerce.number().int().min(0).max(15).default(1),
    // The one knob where a blank value is both accepted and meaningful: `Number('')` is 0
    // and 0 means "force the exit", so every SIGTERM would kill in-flight requests.
    SHUTDOWN_DRAIN_TIMEOUT_MS: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int())
      .default(10_000),
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
