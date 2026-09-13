import { describe, expect, it } from 'vitest';
import express, { type Express, type Request, type RequestHandler, type Response } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '@src/shared/http/request-validator.js';
import { errorHandler } from '@src/shared/http/error-handler.js';
import { httpLogger } from '@src/shared/http/http-logger.js';
import { captureLogger, type CapturedLogger } from '../../capture-logger.js';

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

describe('validate', () => {
  const app = appWith('/products', validate({ body: createProduct }));

  it('passes the parsed body to the handler', async () => {
    const res = await request(app).post('/products').send({ sku: 'SKU-1', basePriceCents: 1999 });

    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ sku: 'SKU-1', basePriceCents: 1999 });
  });

  it('names the key the client got wrong, because they cannot fix it otherwise', async () => {
    const captured = captureLogger();
    const res = await request(appLogging('/products', captured, validate({ body: createProduct })))
      .post('/products')
      .send({ sku: 'SKU-1', basePriceCents: 1999, basePrice: 19.99 });

    expect(res.status).toBe(400);
    // A key they typed is an identifier they can act on; a value they sent is
    // not (REVIEW.md 8.3b).
    expect(res.body.error.details).toContainEqual({
      path: 'body',
      message: 'Unrecognized keys: "basePrice"',
    });
  });

  it('truncates a long key rather than omitting it, in the response too', async () => {
    const long = `vendor${'x'.repeat(200)}`;
    const res = await request(appWith('/products', validate({ body: createProduct })))
      .post('/products')
      .send({ sku: 'SKU-1', basePriceCents: 1, [long]: 1 });

    const details = res.body.error.details as { message: string }[];
    // Quoted whole: a key is the caller's own words back, and the line is bounded by
    // the message cap rather than by a separate rule about keys.
    expect(details).toContainEqual({ path: 'body', message: `Unrecognized keys: "${long}"` });
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
    // 8.3b held by a test rather than by zod's current defaults: a message
    // built with the received value would sail past every other assertion.
    expect(res.text).not.toContain('x'.repeat(50));
  });

  it('keeps zod messages free of internal detail', async () => {
    const res = await request(app).post('/products').send({ sku: 1 });

    expect(res.text).not.toMatch(/at Object|node_modules|\.ts:/);
  });
});

describe('validate — where the problem is', () => {
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

describe('validate — how much one request can cost', () => {
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

describe('validate — query', () => {
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
    expect(res.body.error.message).toBe('Invalid request query');
  });
});

describe('validate — params', () => {
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

describe('validate — nested objects', () => {
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
      message: 'Unrecognized keys: "endAt"',
    });
  });
});

describe('validate — undeclared parts', () => {
  it('leaves a part with no schema raw, so a handler must declare what it reads', async () => {
    const app = appWith('/products/:id', validate({ params: z.object({ id: z.string() }) }));
    const res = await request(app).post('/products/abc').send({ anything: 'unvalidated' });

    expect(res.status).toBe(200);
    expect(res.body.params).toEqual({ id: 'abc' });
    expect(res.body.body).toEqual({ anything: 'unvalidated' });
  });
});

describe('validate — nothing configured', () => {
  it('is a no-op', async () => {
    const res = await request(appWith('/ping', validate({}))).get('/ping');

    expect(res.status).toBe(200);
  });
});

describe('where a params schema may be mounted', () => {
  const idIsNumber = validate({ params: z.object({ id: z.coerce.number() }) });
  const handler = (req: Request, res: Response) => {
    res.json({ id: req.params.id, type: typeof req.params.id });
  };

  it('parses on the route it is attached to', async () => {
    const app = express();
    app.get('/things/:id', idIsNumber, handler);
    app.use(errorHandler);

    const res = await request(app).get('/things/7');

    expect(res.body).toEqual({ id: 7, type: 'number' });
  });

  it('rejects every request when mounted on the router instead', async () => {
    // Express fills req.params per layer match, so at router level there is no
    // :id yet and the schema sees {}. The mistake fails loudly on the first
    // request rather than quietly handing the handler an unparsed string.
    const app = express();
    app.use(httpLogger(captureLogger().logger));
    const router = express.Router();
    router.use(idIsNumber);
    router.get('/things/:id', handler);
    app.use(router);
    app.use(errorHandler);

    const res = await request(app).get('/things/7');

    expect(res.status).toBe(400);
  });
});
