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

  it('parses a valid environment and applies the spec defaults', () => {
    expect(loadConfig(validEnv)).toEqual({
      ...validEnv,
      PORT: 3000,
      UPLOAD_DIR: './uploads',
      REDIS_READ_MODEL_DB: 0,
      REDIS_QUEUE_DB: 1,
      INGESTION_CHUNK_BYTES: 4 * 1024 * 1024,
      INGESTION_BATCH_SIZE: 1000,
      INGESTION_BUDGET_MS: 60_000,
      INGESTION_LEASE_MS: 90_000,
      INGESTION_MAX_FAILURES: 3,
      INGESTION_MAX_WAITING: 100,
    });
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

  // The three failures that would otherwise surface late and quietly.
  it('throws naming DATABASE_URL when it carries no database name', () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: 'postgres://promo@localhost' })).toThrow(
      'DATABASE_URL',
    );
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
