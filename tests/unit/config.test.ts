import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/shared/config.js';

const validEnv = {
  DATABASE_URL: 'postgres://promo:promo@localhost:5432/promotion',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the required variables and returns a frozen object', () => {
    const config = loadConfig(validEnv);

    expect(config.databaseUrl).toBe(validEnv.DATABASE_URL);
    expect(config.redisUrl).toBe(validEnv.REDIS_URL);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.ingestion)).toBe(true);
  });

  it('applies the spec defaults when the optional variables are absent', () => {
    const config = loadConfig(validEnv);

    expect(config.port).toBe(3000);
    expect(config.uploadDir).toBe('./uploads');
    expect(config.redisReadModelDb).toBe(0);
    expect(config.redisQueueDb).toBe(1);
    expect(config.ingestion).toEqual({
      chunkBytes: 4 * 1024 * 1024,
      batchSize: 1000,
      budgetMs: 60_000,
      leaseMs: 90_000,
      maxFailures: 3,
      maxWaiting: 100,
    });
  });

  it('derives one Redis URL per logical database', () => {
    const config = loadConfig(validEnv);

    expect(config.redisReadModelUrl).toBe('redis://localhost:6379/0');
    expect(config.redisQueueUrl).toBe('redis://localhost:6379/1');
  });

  it('keeps credentials and replaces any path when deriving database URLs', () => {
    const config = loadConfig({
      ...validEnv,
      REDIS_URL: 'redis://user:pass@redis.internal:6380/7',
      REDIS_READ_MODEL_DB: '3',
      REDIS_QUEUE_DB: '4',
    });

    expect(config.redisReadModelUrl).toBe('redis://user:pass@redis.internal:6380/3');
    expect(config.redisQueueUrl).toBe('redis://user:pass@redis.internal:6380/4');
  });

  it('reads overrides for every optional variable', () => {
    const config = loadConfig({
      ...validEnv,
      PORT: '8080',
      UPLOAD_DIR: '/data/uploads',
      REDIS_READ_MODEL_DB: '2',
      REDIS_QUEUE_DB: '5',
      INGESTION_CHUNK_BYTES: '1024',
      INGESTION_BATCH_SIZE: '250',
      INGESTION_BUDGET_MS: '2000',
      INGESTION_LEASE_MS: '32000',
      INGESTION_MAX_FAILURES: '5',
      INGESTION_MAX_WAITING: '20',
    });

    expect(config.port).toBe(8080);
    expect(config.uploadDir).toBe('/data/uploads');
    expect(config.redisReadModelDb).toBe(2);
    expect(config.redisQueueDb).toBe(5);
    expect(config.ingestion).toEqual({
      chunkBytes: 1024,
      batchSize: 250,
      budgetMs: 2000,
      leaseMs: 32000,
      maxFailures: 5,
      maxWaiting: 20,
    });
  });

  it('defaults to process.env when no environment is injected', () => {
    vi.stubEnv('DATABASE_URL', validEnv.DATABASE_URL);
    vi.stubEnv('REDIS_URL', validEnv.REDIS_URL);

    expect(loadConfig().databaseUrl).toBe(validEnv.DATABASE_URL);
  });

  describe('required variables', () => {
    it.each(['DATABASE_URL', 'REDIS_URL'])('throws naming %s when it is missing', (key) => {
      const env: Record<string, string> = { ...validEnv };
      delete env[key];

      expect(() => loadConfig(env)).toThrow(`Missing required environment variable: ${key}`);
    });

    it.each(['DATABASE_URL', 'REDIS_URL'])('throws naming %s when it is blank', (key) => {
      expect(() => loadConfig({ ...validEnv, [key]: '   ' })).toThrow(
        `Missing required environment variable: ${key}`,
      );
    });

    it('trims surrounding whitespace', () => {
      const config = loadConfig({ ...validEnv, DATABASE_URL: '  postgres://x/y  ' });

      expect(config.databaseUrl).toBe('postgres://x/y');
    });

    it('falls back to the default when an optional string is blank', () => {
      const config = loadConfig({ ...validEnv, UPLOAD_DIR: '   ' });

      expect(config.uploadDir).toBe('./uploads');
    });

    it('throws naming DATABASE_URL when it is not a URL', () => {
      expect(() => loadConfig({ ...validEnv, DATABASE_URL: 'localhost/promotion' })).toThrow(
        'Invalid environment variable DATABASE_URL: expected a URL, got "localhost/promotion"',
      );
    });

    it('throws naming REDIS_URL when it is not a URL', () => {
      expect(() => loadConfig({ ...validEnv, REDIS_URL: 'not a url' })).toThrow(
        'Invalid environment variable REDIS_URL: expected a URL, got "not a url"',
      );
    });
  });

  describe('numeric variables', () => {
    it.each([
      'PORT',
      'REDIS_READ_MODEL_DB',
      'REDIS_QUEUE_DB',
      'INGESTION_CHUNK_BYTES',
      'INGESTION_BATCH_SIZE',
      'INGESTION_BUDGET_MS',
      'INGESTION_LEASE_MS',
      'INGESTION_MAX_FAILURES',
      'INGESTION_MAX_WAITING',
    ])('throws naming %s when it is not a number', (key) => {
      expect(() => loadConfig({ ...validEnv, [key]: 'abc' })).toThrow(
        `Invalid environment variable ${key}: expected an integer, got "abc"`,
      );
    });

    it('rejects a decimal value', () => {
      expect(() => loadConfig({ ...validEnv, PORT: '30.5' })).toThrow(
        'Invalid environment variable PORT: expected an integer, got "30.5"',
      );
    });

    it('rejects an empty numeric value instead of falling back to the default', () => {
      expect(() => loadConfig({ ...validEnv, PORT: '' })).toThrow(
        'Invalid environment variable PORT: expected an integer, got ""',
      );
    });

    it.each([
      ['PORT', '0'],
      ['INGESTION_CHUNK_BYTES', '0'],
      ['INGESTION_BATCH_SIZE', '0'],
      ['INGESTION_BUDGET_MS', '0'],
      ['INGESTION_LEASE_MS', '0'],
      ['INGESTION_MAX_FAILURES', '0'],
      ['INGESTION_MAX_WAITING', '0'],
    ])('rejects zero for %s, which must be positive', (key, value) => {
      expect(() => loadConfig({ ...validEnv, [key]: value })).toThrow(
        `Invalid environment variable ${key}: expected an integer between 1 and`,
      );
    });

    it.each([
      ['PORT', '-1'],
      ['REDIS_READ_MODEL_DB', '-1'],
      ['INGESTION_BATCH_SIZE', '-5'],
    ])('rejects a negative value for %s', (key, value) => {
      expect(() => loadConfig({ ...validEnv, [key]: value })).toThrow(
        `Invalid environment variable ${key}: expected an integer between`,
      );
    });

    it('rejects a port above the maximum', () => {
      expect(() => loadConfig({ ...validEnv, PORT: '65536' })).toThrow(
        'Invalid environment variable PORT: expected an integer between 1 and 65535, got "65536"',
      );
    });

    it('rejects a Redis database index above 15', () => {
      expect(() => loadConfig({ ...validEnv, REDIS_QUEUE_DB: '16' })).toThrow(
        'Invalid environment variable REDIS_QUEUE_DB: expected an integer between 0 and 15, got "16"',
      );
    });

    it('accepts zero for a Redis database index', () => {
      const config = loadConfig({ ...validEnv, REDIS_QUEUE_DB: '0', REDIS_READ_MODEL_DB: '1' });

      expect(config.redisQueueDb).toBe(0);
    });
  });

  it('rejects the read model and the queue sharing one logical database', () => {
    expect(() => loadConfig({ ...validEnv, REDIS_READ_MODEL_DB: '1' })).toThrow(
      'Invalid environment variable REDIS_READ_MODEL_DB: the read model and the queue must use different Redis logical databases, got "1" for both',
    );
  });

  it('rejects a lease shorter than the time budget', () => {
    expect(() =>
      loadConfig({ ...validEnv, INGESTION_BUDGET_MS: '60000', INGESTION_LEASE_MS: '30000' }),
    ).toThrow(
      'Invalid environment variable INGESTION_LEASE_MS: must be at least INGESTION_BUDGET_MS (60000), got "30000"',
    );
  });
});
