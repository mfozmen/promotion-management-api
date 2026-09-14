import { describe, expect, it } from 'vitest';
import express from 'express';
import { z } from 'zod';
import { mountAt } from '@src/shared/http/mount-at.js';
import { openapiDocument } from '@src/shared/http/openapi-document.js';
import { validate } from '@src/shared/http/request-validator.js';

const noop = (_req: express.Request, res: express.Response): void => {
  res.end();
};

function appWith(build: (app: express.Express) => void): express.Express {
  const app = express();
  build(app);

  return app;
}

describe('openapiDocument', () => {
  it('is an OpenAPI 3.1 document', () => {
    const doc = openapiDocument(appWith((app) => app.get('/things', noop)));

    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toMatchObject({ title: expect.any(String), version: expect.any(String) });
  });

  it('writes a path parameter the way OpenAPI spells it, not the way Express does', () => {
    const app = appWith((a) =>
      a.get('/things/:id', validate({ params: z.strictObject({ id: z.string() }) }), noop),
    );

    const doc = openapiDocument(app);

    expect(Object.keys(doc.paths)).toEqual(['/things/{id}']);
    expect(doc.paths['/things/{id}']?.get?.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });

  it('takes each query field as its own parameter, and marks only the required ones', () => {
    const app = appWith((a) =>
      a.get(
        '/things',
        validate({ query: z.strictObject({ category: z.string(), limit: z.string().optional() }) }),
        noop,
      ),
    );

    const parameters = openapiDocument(app).paths['/things']?.get?.parameters;

    expect(parameters).toEqual([
      { name: 'category', in: 'query', required: true, schema: { type: 'string' } },
      { name: 'limit', in: 'query', required: false, schema: { type: 'string' } },
    ]);
  });

  it('describes what a caller sends, not what the handler receives', () => {
    // The id schema parses a string of digits into a number. A document that
    // showed the number would be describing the value after parsing, which is
    // not the thing anyone puts in a URL.
    const app = appWith((a) =>
      a.get(
        '/things/:id',
        validate({
          params: z.strictObject({
            id: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1)),
          }),
        }),
        noop,
      ),
    );

    expect(openapiDocument(app).paths['/things/{id}']?.get?.parameters?.[0]?.schema).toEqual({
      type: 'string',
      pattern: '^\\d+$',
    });
  });

  it('invents no parameters for a schema that declares no fields', () => {
    const app = appWith((a) => a.get('/things', validate({ query: z.strictObject({}) }), noop));

    expect(openapiDocument(app).paths['/things']?.get?.parameters).toBeUndefined();
  });

  it('carries a body schema as the request body', () => {
    const body = z.strictObject({ name: z.string().min(1) });
    const app = appWith((a) => a.post('/things', validate({ body }), noop));

    expect(openapiDocument(app).paths['/things']?.post?.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { name: { type: 'string', minLength: 1 } },
            required: ['name'],
            additionalProperties: false,
          },
        },
      },
    });
  });

  it('points every operation at the one error envelope the API actually sends', () => {
    const app = appWith((a) => a.get('/things', noop));

    const doc = openapiDocument(app);

    expect(doc.paths['/things']?.get?.responses?.default).toEqual({
      description: expect.any(String),
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    });
    expect(doc.components?.schemas?.Error).toEqual({
      type: 'object',
      properties: {
        error: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
      },
      required: ['error'],
    });
  });

  it('includes a route that validates nothing, with no parameters invented for it', () => {
    const doc = openapiDocument(appWith((app) => app.get('/health', noop)));

    expect(doc.paths['/health']?.get?.parameters).toBeUndefined();
    expect(doc.paths['/health']?.get?.requestBody).toBeUndefined();
  });

  it('keeps two methods on one path as two operations', () => {
    const app = appWith((a) => {
      a.get('/things', noop);
      a.post('/things', noop);
    });

    expect(Object.keys(openapiDocument(app).paths['/things'] ?? {}).sort()).toEqual([
      'get',
      'post',
    ]);
  });

  it('says on the document that it describes requests only', () => {
    // A page silent about responses, with nothing saying why, reads as a page
    // that forgot them. The limit is stated where a reader meets it.
    const doc = openapiDocument(appWith((app) => app.get('/things', noop)));

    expect(doc.info.description).toMatch(/README/);
  });

  it('walks a mounted router so the document cannot describe fewer routes than the app serves', () => {
    const things = express.Router();
    things.get('/:id', noop);
    const app = appWith((a) => mountAt(a, '/api/things', things));

    expect(Object.keys(openapiDocument(app).paths)).toEqual(['/api/things/{id}']);
  });
});
