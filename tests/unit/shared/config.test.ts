import { afterEach, describe, expect, it, vi } from 'vitest';
import { productUpserted } from '@src/modules/catalog/domain/dto/product-upserted.js';
import { loadConfig } from '@src/shared/config.js';

const validEnv = {
  DATABASE_URL: 'postgres://promo:promo@localhost:5432/promotion',
  REDIS_URL: 'redis://localhost:6379',
};

const ids = (count: number): number[] => Array.from({ length: count }, (_, i) => i + 1);

const getError = (attempt: () => unknown): unknown => {
  try {
    attempt();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
};

describe('loadConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses a valid environment and applies the spec defaults', () => {
    expect(loadConfig(validEnv)).toEqual({
      ...validEnv,
      PORT: 3100,
      UPLOAD_DIR: './uploads',
      REDIS_READ_MODEL_DB: 0,
      REDIS_QUEUE_DB: 1,
      SHUTDOWN_DRAIN_TIMEOUT_MS: 10_000,
      INGESTION_CHUNK_BYTES: 4 * 1024 * 1024,
      INGESTION_BATCH_SIZE: 1000,
      INGESTION_BUDGET_MS: 60_000,
      INGESTION_LEASE_MS: 90_000,
      INGESTION_MAX_FAILURES: 3,
      INGESTION_MAX_WAITING: 100,
    });
  });

  it.each([
    ['a deliberate zero, which exits immediately', '0', 0],
    ['a real value', '5000', 5_000],
  ])('reads the shutdown drain cap from %s', (_label, raw, expected) => {
    expect(
      loadConfig({ ...validEnv, SHUTDOWN_DRAIN_TIMEOUT_MS: raw }).SHUTDOWN_DRAIN_TIMEOUT_MS,
    ).toBe(expected);
  });

  // The blank case is the one that matters: `Number('')` is 0 and 0 means "force the
  // exit", so a compose block with the value cleared would kill in-flight requests.
  it.each(['', ' ', '-1', 'abc', '1.5', '0x10'])('rejects a shutdown drain cap of %s', (raw) => {
    expect(() => loadConfig({ ...validEnv, SHUTDOWN_DRAIN_TIMEOUT_MS: raw })).toThrow();
  });

  it('keeps the ingestion batch cap and the announcement cap equal', () => {
    // A batch that commits more ids than one product.upserted may carry would
    // dead-letter its own announcement after the rows are already in PostgreSQL.
    const batchCeiling = loadConfig({
      ...validEnv,
      INGESTION_BATCH_SIZE: '5000',
    }).INGESTION_BATCH_SIZE;

    expect(() => productUpserted.parse({ productIds: ids(batchCeiling) })).not.toThrow();
    expect(() => productUpserted.parse({ productIds: ids(batchCeiling + 1) })).toThrow();
    expect(() =>
      loadConfig({ ...validEnv, INGESTION_BATCH_SIZE: String(batchCeiling + 1) }),
    ).toThrow();
  });

  it('coerces overrides to numbers', () => {
    const config = loadConfig({ ...validEnv, PORT: '8080', INGESTION_BATCH_SIZE: '250' });

    expect(config.PORT).toBe(8080);
    expect(config.INGESTION_BATCH_SIZE).toBe(250);
  });

  it('defaults to process.env when no environment is injected', () => {
    vi.stubEnv('DATABASE_URL', validEnv.DATABASE_URL);
    vi.stubEnv('REDIS_URL', validEnv.REDIS_URL);

    expect(loadConfig().DATABASE_URL).toBe(validEnv.DATABASE_URL);
  });

  it('throws naming DATABASE_URL when it is missing', () => {
    expect(() => loadConfig({ REDIS_URL: validEnv.REDIS_URL })).toThrow('DATABASE_URL');
  });

  it('throws naming DATABASE_URL when it carries no database name', () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: 'postgres://promo@localhost' })).toThrow(
      'DATABASE_URL',
    );
  });

  it('throws naming DATABASE_URL without echoing the value when the URL is malformed', () => {
    // The value carries a password and the error reaches a startup log.
    const attempt = () => loadConfig({ ...validEnv, DATABASE_URL: 'not a url s3cretpassw0rd' });

    expect(attempt).toThrow('DATABASE_URL');
    expect(JSON.stringify(getError(attempt))).not.toContain('s3cretpassw0rd');
  });

  it('accepts a lease equal to the budget', () => {
    const config = loadConfig({
      ...validEnv,
      INGESTION_BUDGET_MS: '60000',
      INGESTION_LEASE_MS: '60000',
    });

    expect(config.INGESTION_LEASE_MS).toBe(60_000);
  });

  it('throws naming REDIS_QUEUE_DB when the read model and the queue share a database', () => {
    expect(() => loadConfig({ ...validEnv, REDIS_QUEUE_DB: '0' })).toThrow('REDIS_QUEUE_DB');
  });

  it('throws naming INGESTION_LEASE_MS when the lease is shorter than the budget', () => {
    expect(() => loadConfig({ ...validEnv, INGESTION_LEASE_MS: '1000' })).toThrow(
      'INGESTION_LEASE_MS',
    );
  });
});
