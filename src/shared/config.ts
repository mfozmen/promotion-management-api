// `loadConfig` takes the environment as a parameter so tests inject a fixture
// instead of mutating `process.env`. Validation is hand-written rather than zod:
// the story that adds zod for request bodies may fold this schema into it.

export interface IngestionConfig {
  /** A target, not exact: the boundary moves forward to the next 0x0A. */
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
  /** The two `*Url` fields below are derived from this one. */
  readonly redisUrl: string;
  readonly redisReadModelDb: number;
  /** Never equal to `redisReadModelDb`; the queue must not share it. */
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

/** A connection string typo should fail at startup, not at the first connect, so
 *  the scheme and host are checked too: `new URL` alone accepts `redis://` and
 *  `garbage:`, which parse but cannot be connected to. No message echoes the
 *  value, because a connection string carries a password and this reaches a
 *  startup log. */
const parseUrl = (key: string, value: string, protocols: readonly string[]): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid environment variable ${key}: expected a URL`);
  }
  if (!protocols.includes(url.protocol)) {
    throw new Error(
      `Invalid environment variable ${key}: expected a ${protocols.join(' or ')} URL`,
    );
  }
  if (url.hostname === '') {
    throw new Error(`Invalid environment variable ${key}: the URL has no host`);
  }
  return url;
};

// Only a loopback URL can mean the published port; a container reaching
// `postgres:5432` on the compose network is unaffected by what the host
// publishes. `postgres:` and `redis:` are non-special schemes, so WHATWG `URL`
// leaves the host's case and any trailing dot alone, and the whole 127/8 block
// is loopback, not just 127.0.0.1.
const isLoopback = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host === 'localhost' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host);
};

/**
 * The compose file publishes `*_PORT` and the driver dials `*_URL`, and nothing
 * derives one from the other: moving the published port and forgetting the URL
 * connects the app to whatever else already listens on the old one. Cross-check
 * instead of deriving, because the URL is authoritative in every deployment that
 * has no compose file at all.
 */
const assertPortMatchesUrl = (
  env: Env,
  portKey: string,
  urlKey: string,
  url: URL,
  defaultPort: string,
): void => {
  const published = env[portKey]?.trim();
  if (!published || !isLoopback(url.hostname)) {
    return;
  }
  const dialled = url.port || defaultPort;
  if (dialled !== published) {
    throw new Error(
      `Invalid environment variable ${portKey}: the stack publishes ${published} but ${urlKey} dials ${dialled} on ${url.hostname}; they are not derived from each other, so both have to change together`,
    );
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
  // The raw strings are what the drivers receive; these are the checks on them.
  const databaseBase = parseUrl('DATABASE_URL', databaseUrl, ['postgres:', 'postgresql:']);
  const redisBase = parseUrl('REDIS_URL', redisUrl, ['redis:', 'rediss:']);
  assertPortMatchesUrl(env, 'POSTGRES_PORT', 'DATABASE_URL', databaseBase, '5432');
  assertPortMatchesUrl(env, 'REDIS_PORT', 'REDIS_URL', redisBase, '6379');

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
      // Capped well below PostgreSQL's 65 535 bind parameters, which a
      // multi-row upsert of wide rows blows long before the batch is large.
      batchSize: readInt(env, 'INGESTION_BATCH_SIZE', 1000, 1, 5000),
      budgetMs,
      leaseMs,
      maxFailures: readInt(env, 'INGESTION_MAX_FAILURES', 3, 1, MAX_SAFE_INT),
      maxWaiting: readInt(env, 'INGESTION_MAX_WAITING', 100, 1, MAX_SAFE_INT),
    }),
  });
};
