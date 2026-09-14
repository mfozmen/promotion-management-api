import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundaryRepairs } from '@src/shared/metrics/boundary-repairs.js';
import { measureRequests } from '@src/shared/metrics/request-duration.js';
import { metricsRegistry } from '@src/shared/metrics/metrics-registry.js';
import { queueDepth } from '@src/shared/metrics/queue-depth.js';

const scrape = async (): Promise<string> => metricsRegistry.metrics();

describe('the metrics registry', () => {
  afterEach(() => {
    metricsRegistry.resetMetrics();
  });

  it('carries the default Node metrics, so a scrape says something before we add anything', async () => {
    expect(await scrape()).toContain('process_resident_memory_bytes');
  });

  it('labels a request by its route pattern, not by the path that was asked for', async () => {
    // A series per product id is how the endpoint added to watch memory becomes the memory
    // problem; the pattern is one series for every id.
    const app = express();
    app.use(measureRequests());
    app.get('/products/:id', (_req, res) => {
      res.json({});
    });

    await request(app).get('/products/12345');

    const scraped = await scrape();
    expect(scraped).toContain('route="/products/:id"');
    expect(scraped).not.toContain('12345');
  });

  it('labels a request that matched no route once, rather than by its path', async () => {
    const app = express();
    app.use(measureRequests());
    app.use((_req, res) => {
      res.status(404).json({});
    });

    await request(app).get('/nothing-here');

    const scraped = await scrape();
    expect(scraped).toContain('route="unmatched"');
    expect(scraped).not.toContain('nothing-here');
  });

  it('reads queue depth at scrape time rather than reporting one process share', async () => {
    const waiting = vi.fn<() => Promise<number>>().mockResolvedValue(7);
    const queues = ['promotions', 'maintenance'].map((name) => ({
      name,
      getWaitingCount: waiting,
      getFailedCount: () => Promise.resolve(2),
    }));
    queueDepth(queues);

    const scraped = await scrape();

    expect(scraped).toContain('queue_waiting{queue="promotions"} 7');
    expect(scraped).toContain('queue_failed{queue="maintenance"} 2');
    // Once per queue per scrape, not on a timer and not per publish.
    expect(waiting).toHaveBeenCalledTimes(2);
  });

  it('counts boundary repairs, so "exactly one per boundary" is answerable', async () => {
    boundaryRepairs.inc(3);

    expect(await scrape()).toContain('reconciler_boundary_repairs_total 3');
  });
});
