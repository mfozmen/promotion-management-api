import { describe, expect, it } from 'vitest';
import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '../../src/middleware/request-validator.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { httpLogger } from '../../src/shared/logger.js';
import { captureLogger, type CapturedLogger } from '../capture-logger.js';

/** A one-route app so the helper can be exercised through real HTTP. */
function appLogging(
  path: string,
  captured: CapturedLogger,
  ...handlers: RequestHandler[]
): Express {
  const app = express();
  app.use(httpLogger(captured.logger));
  app.use(express.json());
  app.all(path, ...handlers, (req, res) => {
    res.status(200).json({ body: req.body, query: req.query, params: req.params });
  });
  app.use(errorHandler);

  return app;
}

const appWith = (path: string, ...handlers: RequestHandler[]): Express =>
  appLogging(path, captureLogger(), ...handlers);

const createProduct = z.object({
  sku: z.string().min(1),
  basePriceCents: z.number().int().positive(),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

describe('validate: body', () => {
  const app = appWith('/products', validate({ body: createProduct }));

  it('passes the parsed body to the handler', async () => {
    const res = await request(app).post('/products').send({ sku: 'SKU-1', basePriceCents: 1999 });

    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ sku: 'SKU-1', basePriceCents: 1999 });
  });

  it('rejects an unknown field without quoting it back, and logs it instead', async () => {
    const captured = captureLogger();
    const res = await request(appLogging('/products', captured, validate({ body: createProduct })))
      .post('/products')
      .send({ sku: 'SKU-1', basePriceCents: 1999, basePrice: 19.99 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    // Where, not what: the path is ours and the client needs it; the key is
    // theirs and does not come back.
    expect(res.body.error.details).toContainEqual({
      path: 'body',
      message: 'Unrecognized fields are not accepted here: 1',
    });
    expect(res.text).not.toContain('basePrice');

    expect(captured.lines).toContainEqual(
      expect.objectContaining({ keys: ['basePrice'], msg: 'unrecognized fields rejected' }),
    );
  });

  it('logs the keys at the level the application actually runs at', async () => {
    // The default pino level is `info`. A `debug` line here would be a
    // mitigation that never fires in production while passing every test.
    const captured = captureLogger('info');
    await request(appLogging('/products', captured, validate({ body: createProduct })))
      .post('/products')
      .set('x-request-id', 'trace-validate')
      .send({ sku: 'SKU-1', basePriceCents: 1999, basePrice: 19.99 });

    expect(captured.lines).toContainEqual(
      expect.objectContaining({
        keys: ['basePrice'],
        reqId: 'trace-validate',
        msg: 'unrecognized fields rejected',
      }),
    );
  });

  it('caps what one request can write to the log, in count and in length', async () => {
    // Both are the client's to choose, and this line is written on an
    // unauthenticated path.
    const captured = captureLogger();
    const unknown = Object.fromEntries(
      Array.from({ length: 25 }, (_, i) => [`field${i}`.padEnd(200, 'x'), 1]),
    );
    await request(appLogging('/products', captured, validate({ body: createProduct })))
      .post('/products')
      .send({ sku: 'SKU-1', basePriceCents: 1, ...unknown });

    const line = captured.lines.find((l) => l.msg === 'unrecognized fields rejected') as {
      keys: string[];
      count: number;
    };
    expect(line.keys).toHaveLength(20);
    expect(line.count).toBe(25);
    expect(Math.max(...line.keys.map((key) => key.length))).toBe(64);
  });

  it('counts every unknown field, and logs them all', async () => {
    const captured = captureLogger();
    const res = await request(appLogging('/products', captured, validate({ body: createProduct })))
      .post('/products')
      .send({ sku: 'SKU-1', basePriceCents: 1999, basePrice: 19.99, vendorSecret: 'abc' });

    expect(res.body.error.details).toContainEqual({
      path: 'body',
      message: 'Unrecognized fields are not accepted here: 2',
    });
    expect(res.text).not.toContain('vendorSecret');
    expect(captured.lines).toContainEqual(
      expect.objectContaining({ keys: ['basePrice', 'vendorSecret'] }),
    );
  });

  it('rejects a wrong type', async () => {
    const res = await request(app).post('/products').send({ sku: 'SKU-1', basePriceCents: '1999' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({
      path: 'body.basePriceCents',
      message: expect.any(String),
    });
  });

  it('rejects a missing body', async () => {
    const res = await request(app).post('/products');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an empty string where a value is required', async () => {
    const res = await request(app).post('/products').send({ sku: '', basePriceCents: 1999 });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({
      path: 'body.sku',
      message: expect.any(String),
    });
  });

  it('accepts a Turkish name unchanged', async () => {
    const res = await request(
      appWith('/vendors', validate({ body: z.object({ name: z.string() }) })),
    )
      .post('/vendors')
      .send({ name: '§i§li Giyim §r§nleri' });

    expect(res.body.body).toEqual({ name: '§i§li Giyim §r§nleri' });
  });

  it('preserves surrounding whitespace rather than silently trimming it', async () => {
    const res = await request(
      appWith('/vendors', validate({ body: z.object({ name: z.string() }) })),
    )
      .post('/vendors')
      .send({ name: '  spaced  ' });

    expect(res.body.body).toEqual({ name: '  spaced  ' });
  });

  it('rejects a value longer than its schema allows', async () => {
    const res = await request(
      appWith('/vendors', validate({ body: z.object({ name: z.string().max(120) }) })),
    )
      .post('/vendors')
      .send({ name: 'x'.repeat(5_000) });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({
      path: 'body.name',
      message: expect.any(String),
    });
  });

  it('keeps zod messages free of internal detail', async () => {
    const res = await request(app).post('/products').send({ sku: 1 });

    expect(res.text).not.toMatch(/at Object|node_modules|\.ts:/);
  });
});

describe('validate: where the problem is', () => {
  it('points into an array by index, the way the docs promise', async () => {
    const app = appWith(
      '/imports',
      validate({
        body: z.object({ items: z.array(z.strictObject({ sku: z.string() })) }),
      }),
    );

    const res = await request(app)
      .post('/imports')
      .send({ items: [{ sku: 'a' }, { sku: 'b' }, { sku: 'c' }, { sku: 42 }] });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({
      path: 'body.items[3].sku',
      message: expect.any(String),
    });
  });
});

describe('validate: how much one request can cost', () => {
  it('caps the details it returns, so a bad body cannot amplify into a response', async () => {
    const app = appWith(
      '/imports',
      validate({ body: z.object({ items: z.array(z.strictObject({ sku: z.string() })) }) }),
    );

    const res = await request(app)
      .post('/imports')
      .send({ items: Array.from({ length: 200 }, () => ({ sku: 1 })) });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveLength(20);
  });
});

describe('validate: mounted without the http logger', () => {
  it('still rejects, instead of throwing while trying to log', async () => {
    const app = express();
    app.use(express.json());
    app.post('/products', validate({ body: createProduct }), (_req, res) => {
      res.status(200).end();
    });
    app.use(errorHandler);

    const res = await request(app)
      .post('/products')
      .send({ sku: 'SKU-1', basePriceCents: 1, oops: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.text).not.toContain('oops');
  });
});

describe('validate: query', () => {
  const app = appWith('/products', validate({ query: listQuery }));

  it('coerces and defaults the pagination parameters', async () => {
    const res = await request(app).get('/products');

    expect(res.body.query).toEqual({ page: 1, pageSize: 20 });
  });

  it('coerces numeric strings', async () => {
    const res = await request(app).get('/products?page=3&pageSize=50');

    expect(res.body.query).toEqual({ page: 3, pageSize: 50 });
  });

  it.each([
    ['page below the minimum', 'page=0'],
    ['a negative page', 'page=-1'],
    ['a page above the maximum', 'page=1000001'],
    ['a non-numeric page', 'page=abc'],
    ['a fractional page', 'page=1.5'],
    ['pageSize above the cap', 'pageSize=99999'],
    ['pageSize below the minimum', 'pageSize=0'],
    ['a non-numeric pageSize', 'pageSize=abc'],
    ['an unknown query parameter', 'sortBy=price'],
  ])('rejects %s', async (_name, query) => {
    const res = await request(app).get(`/products?${query}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('Invalid request query');
  });
});

describe('validate: params', () => {
  const app = appWith('/products/:id', validate({ params: z.object({ id: z.uuid() }) }));

  it('passes the parsed params to the handler', async () => {
    const id = '3f1d5b8e-5c5f-4f2a-9a3e-2c7b1d4e6f80';
    const res = await request(app).get(`/products/${id}`);

    expect(res.status).toBe(200);
    expect(res.body.params).toEqual({ id });
  });

  it('rejects a malformed id', async () => {
    const res = await request(app).get('/products/not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Invalid request params');
  });
});

describe('validate: nested objects', () => {
  // `.strict()` applies to the top level only, so every nested object declares
  // its own strictness. This is the convention ADR-0008 records; the test is
  // what keeps it honest.
  const app = appWith(
    '/promotions',
    validate({
      body: z.object({
        name: z.string(),
        window: z.strictObject({ startsAt: z.iso.datetime(), endsAt: z.iso.datetime() }),
      }),
    }),
  );

  it('accepts a well-formed nested object', async () => {
    const window = { startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-02-01T00:00:00Z' };
    const res = await request(app).post('/promotions').send({ name: 'Winter', window });

    expect(res.status).toBe(200);
    expect(res.body.body.window).toEqual(window);
  });

  it('rejects a misspelled field inside a nested strict object', async () => {
    const res = await request(app)
      .post('/promotions')
      .send({
        name: 'Winter',
        window: {
          startsAt: '2026-01-01T00:00:00Z',
          endsAt: '2026-02-01T00:00:00Z',
          endAt: 'oops',
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({
      path: 'body.window',
      message: 'Unrecognized fields are not accepted here: 1',
    });
    expect(res.text).not.toContain('endAt');
  });
});

describe('validate: undeclared parts', () => {
  it('leaves a part with no schema raw, so a handler must declare what it reads', async () => {
    const app = appWith('/products/:id', validate({ params: z.object({ id: z.string() }) }));
    const res = await request(app).post('/products/abc').send({ anything: 'unvalidated' });

    expect(res.status).toBe(200);
    expect(res.body.params).toEqual({ id: 'abc' });
    expect(res.body.body).toEqual({ anything: 'unvalidated' });
  });
});

describe('validate: nothing configured', () => {
  it('is a no-op', async () => {
    const res = await request(appWith('/ping', validate({}))).get('/ping');

    expect(res.status).toBe(200);
  });
});
