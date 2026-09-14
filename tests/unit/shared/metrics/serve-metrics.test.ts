import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@src/shared/logger.js';
import { metricsRegistry } from '@src/shared/metrics/metrics-registry.js';
import { serveMetrics } from '@src/shared/metrics/serve-metrics.js';

const servers: { close: (done: () => void) => void }[] = [];

const listening = (): string => {
  // Port 0 is the OS choosing: two of these in one file must not fight over a number.
  const server = serveMetrics(0);
  servers.push(server);

  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
};

describe('serveMetrics', () => {
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
    );
    vi.restoreAllMocks();
  });

  it('serves the registry on /metrics, which is all a worker needs', async () => {
    const response = await fetch(`${listening()}/metrics`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(metricsRegistry.contentType);
    expect(await response.text()).toContain('process_resident_memory_bytes');
  });

  it('answers 404 elsewhere rather than serving metrics from every path', async () => {
    expect((await fetch(`${listening()}/`)).status).toBe(404);
  });

  it('answers 500 when the registry cannot render, rather than hanging the scrape', async () => {
    // A hung scrape reads as a dead worker to Prometheus, which is the wrong diagnosis.
    vi.spyOn(metricsRegistry, 'metrics').mockRejectedValue(new Error('collector threw'));

    expect((await fetch(`${listening()}/metrics`)).status).toBe(500);
  });

  it('survives a port it cannot bind, rather than taking the worker down with it', async () => {
    // An unhandled `listen` error is an uncaught exception: the worker would exit at boot, before
    // its consumer attaches, and `restart: unless-stopped` would crash-loop it. Telemetry is not
    // load-bearing.
    const failed = vi.spyOn(logger, 'error').mockReturnValue(undefined);
    const taken = createServer();
    await new Promise<void>((done) => taken.listen(0, () => done()));
    const port = (taken.address() as AddressInfo).port;

    const server = serveMetrics(port);
    servers.push(server);
    await new Promise<void>((done) => server.once('error', () => done()));

    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ code: 'EADDRINUSE' }) }),
      'metrics listener failed',
    );
    await new Promise<void>((done) => taken.close(() => done()));
  });
});
