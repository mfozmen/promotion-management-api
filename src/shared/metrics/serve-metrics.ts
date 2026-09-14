import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { logger } from '../logger.js';
import { metricsRegistry } from './metrics-registry.js';

export function serveMetrics(port: number): Server {
  return createServer((req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end();

      return;
    }
    void metricsRegistry
      .metrics()
      .then((body) => {
        res.writeHead(200, { 'content-type': metricsRegistry.contentType }).end(body);
      })
      .catch((err: unknown) => {
        logger.error({ err }, 'metrics collection failed');
        res.writeHead(500).end();
      });
  })
    .on('error', (err: unknown) => {
      // Telemetry is not load-bearing: an unhandled `listen` error would exit the worker at boot,
      // before its consumer attaches, and `restart: unless-stopped` would crash-loop it.
      logger.error({ err }, 'metrics listener failed');
    })
    .listen(port);
}
