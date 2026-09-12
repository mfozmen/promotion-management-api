import { describe, expect, it } from 'vitest';
import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '../src/middleware/validate.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { httpLogger } from '../src/shared/logger.js';
import { captureLogger } from './helpers/capture-logger.js';

/** A one-route app so the helper can be exercised through real HTTP. */
function appWith(path: string, ...handlers: RequestHandler[]): Express {
  const app = express();
  app.use(httpLogger(captureLogger().logger));
  app.use(express.json());
  app.all(path, ...handlers, (req, res) => {
    res.status(200).json({ body: req.body, query: req.query, params: req.params });
  });
  app.use(errorHandler);

  return app;
}

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

  it('rejects an unknown field so a client typo is visible', async () => {
    const res = await request(app)
      .post('/products')
      .send({ sku: 'SKU-1', basePriceCents: 1999, basePrice: 19.99 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('Invalid request body');
    expect(res.body.error.details).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('basePrice') }),
    );
  });

  it('rejects a wrong type', async () => {
    const res = await request(app).post('/products').send({ sku: 'SKU-1', basePriceCents: '1999' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({
      path: 'basePriceCents',
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
    expect(res.body.error.details).toContainEqual({ path: 'sku', message: expect.any(String) });
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
    expect(res.body.error.details).toContainEqual({ path: 'name', message: expect.any(String) });
  });

  it('keeps zod messages free of internal detail', async () => {
    const res = await request(app).post('/products').send({ sku: 1 });

    expect(res.text).not.toMatch(/at Object|node_modules|\.ts:/);
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
    expect(res.body.error.details).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('endAt') }),
    );
  });
});

describe('validate: nothing configured', () => {
  it('is a no-op', async () => {
    const res = await request(appWith('/ping', validate({}))).get('/ping');

    expect(res.status).toBe(200);
  });
});
