/**
 * Environment configuration, read and validated once at startup.
 *
 * `loadConfig` takes the environment as a parameter so tests inject a fixture
 * instead of mutating `process.env`. Validation is hand-written so that the
 * first module in the repository does not pull in a dependency for twenty
 * lines of parsing; the story that adds zod for request bodies may fold this
 * schema into it.
 */

export interface IngestionConfig {
  /** Target chunk size in bytes; boundaries move forward to the next 0x0A. */
  readonly chunkBytes: number;
  /** Rows per upsert transaction. */
  readonly batchSize: number;
  /** Time budget for one chunk invocation before it checkpoints and hands off. */
  readonly budgetMs: number;
  /** Chunk claim lease; must outlive the time budget so a healthy run keeps its claim. */
  readonly leaseMs: number;
  readonly maxFailures: number;
  /** Waiting jobs above which new imports are rejected with 429 (backpressure). */
  readonly maxWaiting: number;
}

export interface Config {
  readonly port: number;
  readonly databaseUrl: string;
  readonly uploadDir: string;
  /** Base Redis URL; the logical databases below are derived from it. */
  readonly redisUrl: string;
  readonly redisReadModelDb: number;
  /** Logical database holding the BullMQ queues; never the read model's. */
  readonly redisQueueDb: number;
  readonly redisReadModelUrl: string;
  readonly redisQueueUrl: string;
  readonly ingestion: IngestionConfig;
}

type Env = Record<string, string | undefined>;

const invalid = (key: string, detail: string, value: string): never => {
  throw new Error(`Invalid environment variable ${key}: ${detail}, got "${value}"`);
};

const requireString = (env: Env, key: string): string => {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

/** A connection string typo should fail at startup, not at the first connect. */
const parseUrl = (key: string, value: string): URL => {
  try {
    return new URL(value);
  } catch {
    // The value is not echoed: a connection string carries a password, and this
    // message reaches a startup log.
    throw new Error(`Invalid environment variable ${key}: expected a URL`);
  }
};

const readInt = (env: Env, key: string, fallback: number, min: number, max: number): number => {
  const raw = env[key];
  if (raw === undefined) {
    return fallback;
  }
  if (!/^-?\d+$/.test(raw.trim())) {
    return invalid(key, 'expected an integer', raw);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    return invalid(key, `expected an integer between ${min} and ${max}`, raw);
  }
  return value;
};

const MAX_SAFE_INT = Number.MAX_SAFE_INTEGER;

const redisUrlForDb = (baseUrl: URL, db: number): string => {
  const url = new URL(baseUrl.href);
  url.pathname = `/${db}`;
  return url.href;
};

export const loadConfig = (env: Env = process.env): Config => {
  const databaseUrl = requireString(env, 'DATABASE_URL');
  const redisUrl = requireString(env, 'REDIS_URL');
  // Shape check only: the raw strings are what the drivers receive.
  parseUrl('DATABASE_URL', databaseUrl);
  const redisBase = parseUrl('REDIS_URL', redisUrl);

  const redisReadModelDb = readInt(env, 'REDIS_READ_MODEL_DB', 0, 0, 15);
  const redisQueueDb = readInt(env, 'REDIS_QUEUE_DB', 1, 0, 15);
  if (redisReadModelDb === redisQueueDb) {
    throw new Error(
      `Invalid environment variable REDIS_READ_MODEL_DB: the read model and the queue must use different Redis logical databases, got "${redisReadModelDb}" for both`,
    );
  }

  const budgetMs = readInt(env, 'INGESTION_BUDGET_MS', 60_000, 1, MAX_SAFE_INT);
  const leaseMs = readInt(env, 'INGESTION_LEASE_MS', 90_000, 1, MAX_SAFE_INT);
  if (leaseMs < budgetMs) {
    throw new Error(
      `Invalid environment variable INGESTION_LEASE_MS: must be at least INGESTION_BUDGET_MS (${budgetMs}), got "${leaseMs}"`,
    );
  }

  return Object.freeze({
    port: readInt(env, 'PORT', 3000, 1, 65_535),
    databaseUrl,
    uploadDir: env.UPLOAD_DIR?.trim() || './uploads',
    redisUrl,
    redisReadModelDb,
    redisQueueDb,
    redisReadModelUrl: redisUrlForDb(redisBase, redisReadModelDb),
    redisQueueUrl: redisUrlForDb(redisBase, redisQueueDb),
    ingestion: Object.freeze({
      chunkBytes: readInt(env, 'INGESTION_CHUNK_BYTES', 4 * 1024 * 1024, 1, MAX_SAFE_INT),
      batchSize: readInt(env, 'INGESTION_BATCH_SIZE', 1000, 1, MAX_SAFE_INT),
      budgetMs,
      leaseMs,
      maxFailures: readInt(env, 'INGESTION_MAX_FAILURES', 3, 1, MAX_SAFE_INT),
      maxWaiting: readInt(env, 'INGESTION_MAX_WAITING', 100, 1, MAX_SAFE_INT),
    }),
  });
};
