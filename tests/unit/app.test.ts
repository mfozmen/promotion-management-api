import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '@src/app.js';
import { captureLogger } from '../capture-logger.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('unknown routes', () => {
  it('does not advertise the framework it runs on', async () => {
    const res = await request(createApp()).get('/api/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('answers with the JSON error shape instead of Express HTML', async () => {
    const res = await request(createApp()).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.type).toBe('application/json');
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('does not echo the requested path back to the client', async () => {
    const res = await request(createApp()).get('/api/<script>alert(1)</script>');

    expect(res.text).not.toContain('script');
  });
});

describe('correlation id', () => {
  it('reuses the incoming x-request-id and logs every line with it', async () => {
    const { logger, lines } = captureLogger();
    const res = await request(createApp({ logger }))
      .get('/api/health')
      .set('x-request-id', 'trace-abc-123');

    expect(res.headers['x-request-id']).toBe('trace-abc-123');
    expect(lines).not.toHaveLength(0);
    expect(lines.every((line) => line.reqId === 'trace-abc-123')).toBe(true);
  });

  it('generates a uuid when the header is absent', async () => {
    const { logger, lines } = captureLogger();
    const res = await request(createApp({ logger })).get('/api/health');

    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(lines.every((line) => line.reqId === res.headers['x-request-id'])).toBe(true);
  });

  it('generates a uuid when the incoming header is not a safe token', async () => {
    const { logger } = captureLogger();
    const res = await request(createApp({ logger }))
      .get('/api/health')
      .set('x-request-id', 'not a token; drop table products');

    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('logs one request-completed line with method, url and status', async () => {
    const { logger, lines } = captureLogger();
    await request(createApp({ logger })).get('/api/health');

    const completed = lines.filter((line) => line.res !== undefined);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      req: { method: 'GET', path: '/api/health' },
      res: { statusCode: 200 },
    });
  });

  it('never logs the query string, which a future endpoint could fill with a token', async () => {
    const { logger, lines } = captureLogger();
    await request(createApp({ logger })).get('/api/health?token=leak-me');

    expect(JSON.stringify(lines)).not.toContain('leak-me');
  });
});

describe('request body size cap', () => {
  it('rejects a body over the cap with a JSON error', async () => {
    const res = await request(createApp())
      .post('/api/health')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(200_000) }));

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    });
  });

  it('accepts a body under the cap', async () => {
    const res = await request(createApp())
      .post('/api/health')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(1_000) }));

    expect(res.status).toBe(404);
  });

  it('rejects a malformed JSON body with a validation error', async () => {
    const res = await request(createApp())
      .post('/api/health')
      .set('content-type', 'application/json')
      .send('{ not json');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Request body could not be read' },
    });
  });

  it('answers an unsupported charset with 415, not a 500 the on-call is paged for', async () => {
    const res = await request(createApp())
      .post('/api/health')
      .set('content-type', 'application/json; charset=iso-8859-9')
      .send('{}');

    expect(res.status).toBe(415);
    expect(res.body).toEqual({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Request body encoding is not supported',
      },
    });
  });

  it('answers a body that will not decompress as the client error it is', async () => {
    // Before the mapping keyed off the status, only two body-parser types were
    // named and everything else was masked as a 500 — so a client's own mistake
    // alerted as a server fault.
    const res = await request(createApp())
      .post('/api/health')
      .set('content-type', 'application/json')
      .set('content-encoding', 'br')
      .send('{}');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Request body could not be read' },
    });
  });
});

describe('log hygiene', () => {
  it('never logs credentials or the request body', async () => {
    const { logger, lines } = captureLogger();
    await request(createApp({ logger }))
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
    const res = await request(createApp()).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('is no longer served at the root path', async () => {
    const res = await request(createApp()).get('/health');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
});
