import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '@src/app.js';
import type { Logger } from 'pino';
import { appDeps } from '@tests/app-deps.js';
import { metricsRegistry } from '@src/shared/metrics/metrics-registry.js';
import { logger as rootLogger } from '@src/shared/logger.js';
import { captureLogger } from './capture-logger.js';

const deps = (logger: Logger) => appDeps({ logger });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('GET /metrics', () => {
  it('serves the registry outside `/api`, so a scrape is not part of the API contract', async () => {
    const res = await request(createApp(appDeps())).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.text).toContain('process_resident_memory_bytes');
  });

  it('is not under the /api prefix, where the error envelope would wrap it', async () => {
    expect((await request(createApp(appDeps())).get('/api/metrics')).status).toBe(404);
  });

  it('answers 500 and says so when a collector throws, rather than hanging the scrape', async () => {
    // A hung scrape reads as a dead process to Prometheus, which is the wrong diagnosis; a bare
    // 500 reads as the endpoint being broken when it is one collector. `serve-metrics` covers
    // the same path on the worker side.
    const error = vi.spyOn(rootLogger, 'error').mockReturnValue(undefined);
    vi.spyOn(metricsRegistry, 'metrics').mockRejectedValue(new Error('collector threw'));

    const res = await request(createApp(appDeps())).get('/metrics');

    expect(res.status).toBe(500);
    expect(error).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: 'collector threw' }) },
      'metrics collection failed',
    );
    vi.restoreAllMocks();
  });

  it('counts a request under its route pattern, never the id in the path', async () => {
    // One series per product is how the endpoint added to watch memory becomes the memory
    // problem. The library normalises; this asserts the id it normalised away is not a label.
    const app = createApp(appDeps());
    await request(app).get('/api/products/12345');

    const res = await request(app).get('/metrics');

    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).not.toContain('12345');
  });
});

describe('unknown routes', () => {
  it('does not advertise the framework it runs on', async () => {
    const res = await request(createApp(deps(rootLogger))).get('/api/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('answers with the JSON error shape instead of Express HTML', async () => {
    const res = await request(createApp(deps(rootLogger))).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.type).toBe('application/json');
    expect(res.body).toEqual({ error: { message: 'Route not found' } });
  });

  it('does not echo the requested path back to the client', async () => {
    const res = await request(createApp(deps(rootLogger))).get('/api/<script>alert(1)</script>');

    expect(res.text).not.toContain('script');
  });
});

describe('correlation id', () => {
  it('reuses the incoming x-request-id and logs every line with it', async () => {
    const { logger, lines } = captureLogger();
    const res = await request(createApp(deps(logger)))
      .get('/api/health')
      .set('x-request-id', 'trace-abc-123');

    expect(res.headers['x-request-id']).toBe('trace-abc-123');
    expect(lines).not.toHaveLength(0);
    expect(lines.every((line) => line.reqId === 'trace-abc-123')).toBe(true);
  });

  it('generates a uuid when the header is absent', async () => {
    const { logger, lines } = captureLogger();
    const res = await request(createApp(deps(logger))).get('/api/health');

    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(lines.every((line) => line.reqId === res.headers['x-request-id'])).toBe(true);
  });

  it('generates a uuid when the incoming header is not a safe token', async () => {
    const { logger } = captureLogger();
    const res = await request(createApp(deps(logger)))
      .get('/api/health')
      .set('x-request-id', 'not a token; drop table products');

    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('logs one request-completed line with method, url and status', async () => {
    const { logger, lines } = captureLogger();
    await request(createApp(deps(logger))).get('/api/health');

    const completed = lines.filter((line) => line.res !== undefined);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      req: { method: 'GET', path: '/api/health' },
      res: { statusCode: 200 },
    });
  });

  it('never logs the query string, which a future endpoint could fill with a token', async () => {
    const { logger, lines } = captureLogger();
    await request(createApp(deps(logger))).get('/api/health?token=leak-me');

    expect(JSON.stringify(lines)).not.toContain('leak-me');
  });
});

describe('request body size cap', () => {
  it('rejects a body over the cap with a JSON error', async () => {
    const res = await request(createApp(deps(rootLogger)))
      .post('/api/health')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(200_000) }));

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: { message: 'request entity too large' },
    });
  });

  it('accepts a body under the cap', async () => {
    const res = await request(createApp(deps(rootLogger)))
      .post('/api/health')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(1_000) }));

    expect(res.status).toBe(404);
  });

  it('rejects a malformed JSON body without echoing it back', async () => {
    const { logger, lines } = captureLogger();
    const res = await request(createApp(deps(logger)))
      .post('/api/health')
      .set('content-type', 'application/json')
      .send('{ not json');

    expect(res.status).toBe(400);
    // body-parser marks its own message `expose` and puts the parser's position
    // and the body into it. The caller already knows what it sent.
    expect(res.body).toEqual({ error: { message: 'Invalid JSON body' } });
    expect(JSON.stringify(res.body)).not.toContain('not json');
    expect(JSON.stringify(res.body)).not.toContain('position');
    // The operator still gets it.
    expect(lines.map((line) => line.reason).join(' ')).toContain('JSON at position');
  });

  it('answers an unsupported charset with 415, not a 500 the on-call is paged for', async () => {
    const res = await request(createApp(deps(rootLogger)))
      .post('/api/health')
      .set('content-type', 'application/json; charset=iso-8859-9')
      .send('{}');

    expect(res.status).toBe(415);
    expect(res.body).toEqual({
      error: { message: 'unsupported charset "ISO-8859-9"' },
    });
  });

  it('answers a body that will not decompress as the client error it is', async () => {
    // Before the mapping keyed off the status, only two body-parser types were
    // named and everything else was masked as a 500 — so a client's own mistake
    // alerted as a server fault.
    const res = await request(createApp(deps(rootLogger)))
      .post('/api/health')
      .set('content-type', 'application/json')
      .set('content-encoding', 'br')
      .send('{}');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { message: 'Decompression failed' },
    });
  });
});

describe('log hygiene', () => {
  it('never logs credentials or the request body', async () => {
    const { logger, lines } = captureLogger();
    await request(createApp(deps(logger)))
      .post('/api/health')
      .set('authorization', 'Bearer super-secret-token')
      .set('cookie', 'session=super-secret-session')
      .send({ password: 'super-secret-password' });

    const serialised = JSON.stringify(lines);
    expect(serialised).not.toContain('super-secret');
    expect(serialised).not.toContain('authorization');
  });
});

describe('GET /api/health', () => {
  it('returns 200 and status ok', async () => {
    const res = await request(createApp(deps(rootLogger))).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('is no longer served at the root path', async () => {
    const res = await request(createApp(deps(rootLogger))).get('/health');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { message: 'Route not found' } });
  });
});

describe('GET /api/ready', () => {
  const stores = (dbUp: boolean, redisUp: boolean) =>
    appDeps({
      db: {
        execute: () => (dbUp ? Promise.resolve([]) : Promise.reject(new Error('refused'))),
      },
      products: {
        ping: () => (redisUp ? Promise.resolve('PONG') : Promise.reject(new Error('refused'))),
      },
    } as never);

  it('answers 200 and names both stores when each one replies', async () => {
    const res = await request(createApp(stores(true, true))).get('/api/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', dependencies: { postgres: 'up', redis: 'up' } });
  });

  it('answers 503 naming the store that is down, rather than a bare failure', async () => {
    // The point of the route is which one: a load balancer needs the code and an
    // operator needs the name, and a 503 with neither sends them to the logs.
    const res = await request(createApp(stores(true, false))).get('/api/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'degraded',
      dependencies: { postgres: 'up', redis: 'down' },
    });
  });

  it('keeps /api/health answering 200 while a store is down', async () => {
    // Liveness, not readiness: every worker waits on `api` being healthy, so a
    // health route that failed here would stop the workers that repair it from
    // ever starting.
    const res = await request(createApp(stores(false, false))).get('/api/health');

    expect(res.status).toBe(200);
  });
});
