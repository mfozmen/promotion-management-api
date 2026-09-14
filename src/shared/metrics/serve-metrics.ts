import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { logger } from '../logger.js';
import { metricsRegistry } from './metrics-registry.js';

/**
 * A worker has no HTTP surface of its own, and the numbers a scrape wants — the sweep's repair
 * count, this process's heap — exist only inside it. One route, no framework: adding Express to a
 * process whose whole job is a queue consumer would be a dependency for four lines.
 */
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
  }).listen(port);
}
