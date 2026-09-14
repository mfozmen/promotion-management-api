import { describe, expect, it } from 'vitest';
import express from 'express';
import { z } from 'zod';
import { mountAt } from '@src/shared/http/mount-at.js';
import { routeInventory } from '@src/shared/http/route-inventory.js';
import { validate } from '@src/shared/http/request-validator.js';

const body = z.strictObject({ name: z.string() });
const params = z.strictObject({ id: z.string() });
const query = z.strictObject({ limit: z.string() });

const noop = (_req: express.Request, res: express.Response): void => {
  res.end();
};

describe('routeInventory', () => {
  it('reads the method and full path of every mounted route', () => {
    const things = express.Router();
    things.get('/', noop);
    things.post('/:id/rename', noop);
    const api = express.Router();
    api.get('/health', noop);
    mountAt(api, '/things', things);
    const app = express();
    mountAt(app, '/api', api);

    expect(routeInventory(app).map((route) => `${route.method} ${route.path}`)).toEqual([
      'get /api/health',
      'get /api/things',
      'post /api/things/:id/rename',
    ]);
  });

  it('carries the schemas the route validates with, so nothing describes a route twice', () => {
    const things = express.Router();
    things.post('/:id', validate({ params }), validate({ body }), noop);
    const app = express();
    mountAt(app, '/things', things);

    const [route] = routeInventory(app);

    // Two validate calls on one route: the route's inputs are their union, and a
    // reader of the document sees both without either being written down again.
    expect(route?.schemas).toEqual({ params, body });
  });

  it('reports a route that validates nothing, rather than leaving it out', () => {
    // Left out, it would be a route the document does not mention; reported with
    // no schemas, the parity check still sees it and can decide.
    const app = express();
    const things = express.Router();
    things.get('/', noop);
    mountAt(app, '/things', things);

    expect(routeInventory(app)).toEqual([{ method: 'get', path: '/things', schemas: {} }]);
  });

  it('finds a route declared straight on the app, with no router between', () => {
    const app = express();
    app.get('/metrics', noop);

    expect(routeInventory(app)).toEqual([{ method: 'get', path: '/metrics', schemas: {} }]);
  });

  it('gives the root route a path of its own rather than an empty string', () => {
    const app = express();
    app.get('/', noop);

    expect(routeInventory(app)[0]?.path).toBe('/');
  });

  it('still finds a router mounted the plain way, at the path it declares', () => {
    // `mountAt` is how a router gets its prefix; mounted with `use` there is
    // nothing to read, so its routes are reported without one. They are reported
    // rather than dropped, because a route missing from the inventory is a route
    // the parity check cannot see either.
    const things = express.Router();
    things.get('/things', noop);
    const app = express();
    app.use('/plain', things);

    expect(routeInventory(app).map((route) => route.path)).toEqual(['/things']);
  });

  it('keeps a query schema apart from a body schema', () => {
    const app = express();
    app.get('/things', validate({ query }), noop);

    expect(routeInventory(app)[0]?.schemas).toEqual({ query });
  });
});
