import type { Redis } from 'ioredis';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '@src/app.js';

/**
 * One shape the real server cannot produce on demand: `pipeline.exec()` is
 * typed nullable because ioredis answers null for a transaction that a WATCH
 * aborted. The listing uses a plain pipeline, which has no WATCH, so the branch
 * is unreachable against a live Redis and is pinned here instead.
 */
const redisAnsweringNoReplies = {
  exists: () => Promise.resolve(1),
  zrange: () => Promise.resolve(['1']),
  zcard: () => Promise.resolve(1),
  pipeline: () => ({ hgetall: () => undefined, exec: () => Promise.resolve(null) }),
} as unknown as Redis;

describe('when Redis answers a pipeline with nothing at all', () => {
  it('serves an empty page rather than failing', async () => {
    const res = await request(createApp({ redis: redisAnsweringNoReplies })).get('/api/products');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], total: 1 });
  });
});

describe('when the product routes have no Redis to read', () => {
  it('serves the liveness probe and leaves the storefront unmounted', async () => {
    const app = createApp();

    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/products')).status).toBe(404);
  });
});
