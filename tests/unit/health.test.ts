import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '@src/app.js';

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
