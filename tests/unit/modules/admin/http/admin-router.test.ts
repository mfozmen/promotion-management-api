import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '@src/app.js';
import { ProductReadRepository } from '@src/modules/storefront/db/product-read-repository.js';
import { logger as rootLogger } from '@src/shared/logger.js';
import type { QueueStats } from '@src/modules/admin/domain/dto/queue-stats.js';
import { captureLogger } from '../../../capture-logger.js';

const STATS: QueueStats[] = [
  { queue: 'promotions', waiting: 2, active: 1, delayed: 7, failed: 0, oldestWaitingAgeSeconds: 3 },
  {
    queue: 'ingestion',
    waiting: 0,
    active: 0,
    delayed: 0,
    failed: 4,
    oldestWaitingAgeSeconds: null,
  },
];

const reporterOf = (report: () => Promise<QueueStats[]>) => ({ report });

/** No case here reaches a product route, so the read repository is never called. */
const products = {} as ProductReadRepository;

describe('adminRouter', () => {
  it('answers the queue stats an operator asks for', async () => {
    const app = createApp(
      rootLogger,
      products,
      reporterOf(() => Promise.resolve(STATS)),
    );

    const res = await request(app).get('/api/admin/queues/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ queues: STATS });
  });

  it('is absent rather than empty when the queue is not wired', async () => {
    // A route answering `{ queues: [] }` with no bus behind it would read as four idle
    // queues, which is the one answer an operator must never be given wrongly.
    const res = await request(createApp(rootLogger, products)).get('/api/admin/queues/stats');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { message: 'Route not found' } });
  });

  it('gives the operator the envelope and the log line when Redis is unreachable', async () => {
    const { logger, lines } = captureLogger();
    const app = createApp(
      logger,
      products,
      reporterOf(() => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:6379'))),
    );

    const res = await request(app).get('/api/admin/queues/stats');

    expect(res.status).toBe(500);
    // The address is an internal detail and the caller is told nothing (REVIEW.md 8.4);
    // the operator greps the reqId and finds the error itself.
    expect(res.body).toEqual({ error: { message: 'Internal server error' } });
    expect(lines.some((line) => line.msg === 'unhandled error')).toBe(true);
  });
});
