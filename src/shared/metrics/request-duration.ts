import { Histogram } from 'prom-client';
import type { RequestHandler } from 'express';
import { metricsRegistry } from './metrics-registry.js';

/** `prom-client`'s own default buckets, which cover 1 ms to 10 s; nothing here justifies others. */
const requestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Request duration by route, method and status',
  labelNames: ['method', 'route', 'status'],
  registers: [metricsRegistry],
});

/**
 * The route pattern, never the path: `/api/products/:id` is one series and
 * `/api/products/12345` is a series per product, which is how a metrics endpoint becomes the
 * memory problem it was added to watch. An unmatched request has no pattern, so it is labelled
 * once as `unmatched` rather than by whatever was asked for.
 */
export const measureRequests = (): RequestHandler => (req, res, next) => {
  const done = requestDuration.startTimer();

  res.on('finish', () => {
    const pattern: unknown =
      req.route === undefined ? undefined : (req.route as { path?: unknown }).path;
    done({
      method: req.method,
      route: typeof pattern === 'string' ? `${req.baseUrl}${pattern}` : 'unmatched',
      status: String(res.statusCode),
    });
  });

  next();
};
