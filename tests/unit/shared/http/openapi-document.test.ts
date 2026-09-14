import { describe, expect, it } from 'vitest';
import express, { Router } from 'express';
import { z } from 'zod';
import { bodyReadBy } from '@src/shared/http/body-read-by.js';
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
    const doc = openapiDocument(appWith((app) => app.get('/api/things', noop)));

    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toMatchObject({ title: expect.any(String), version: expect.any(String) });
  });

  it('writes a path parameter the way OpenAPI spells it, not the way Express does', () => {
    const app = appWith((a) =>
      a.get('/api/things/:id', validate({ params: z.strictObject({ id: z.string() }) }), noop),
    );

    const doc = openapiDocument(app);

    expect(Object.keys(doc.paths)).toEqual(['/api/things/{id}']);
    expect(doc.paths['/api/things/{id}']?.get?.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });

  it('takes each query field as its own parameter, and marks only the required ones', () => {
    const app = appWith((a) =>
      a.get(
        '/api/things',
        validate({ query: z.strictObject({ category: z.string(), limit: z.string().optional() }) }),
        noop,
      ),
    );

    const parameters = openapiDocument(app).paths['/api/things']?.get?.parameters;

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
        '/api/things/:id',
        validate({
          params: z.strictObject({
            id: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1)),
          }),
        }),
        noop,
      ),
    );

    expect(openapiDocument(app).paths['/api/things/{id}']?.get?.parameters?.[0]?.schema).toEqual({
      type: 'string',
      pattern: '^\\d+$',
    });
  });

  it('invents no parameters for a schema that declares no fields', () => {
    const app = appWith((a) => a.get('/api/things', validate({ query: z.strictObject({}) }), noop));

    expect(openapiDocument(app).paths['/api/things']?.get?.parameters).toBeUndefined();
  });

  it('carries a body schema as the request body', () => {
    const body = z.strictObject({ name: z.string().min(1) });
    const app = appWith((a) => a.post('/api/things', validate({ body }), noop));

    expect(openapiDocument(app).paths['/api/things']?.post?.requestBody).toEqual({
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
    const app = appWith((a) => a.get('/api/things', noop));

    const doc = openapiDocument(app);

    expect(doc.paths['/api/things']?.get?.responses?.default).toEqual({
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
    const doc = openapiDocument(appWith((app) => app.get('/api/health', noop)));

    expect(doc.paths['/api/health']?.get?.parameters).toBeUndefined();
    expect(doc.paths['/api/health']?.get?.requestBody).toBeUndefined();
  });

  it('names what reads a body this document cannot describe, and the fields it takes', () => {
    // Swagger UI deep-links, so a reader arrives at the operation rather than at
    // the document's description. The field names have to be where they land.
    const app = appWith((a) =>
      a.post('/api/vendor/imports', bodyReadBy(noop, 'multipart/form-data: file, vendor'), noop),
    );

    const operation = openapiDocument(app).paths['/api/vendor/imports']?.post;

    expect(operation?.description).toContain('multipart/form-data: file, vendor');
  });

  it('says an operation takes nothing when nothing reads its body either', () => {
    // Not the same sentence as above: `/api/health` has no inputs, and telling
    // its reader about a multipart upload would be a new false impression in the
    // place the other line exists to remove one.
    const app = appWith((a) => a.get('/api/health', noop));

    expect(openapiDocument(app).paths['/api/health']?.get?.description).toMatch(/no inputs/i);
  });

  it('says nothing extra on an operation whose inputs a schema does describe', () => {
    const app = appWith((a) =>
      a.post('/api/things', validate({ body: z.strictObject({ name: z.string() }) }), noop),
    );

    expect(openapiDocument(app).paths['/api/things']?.post?.description).toBeUndefined();
  });

  it('keeps two methods on one path as two operations', () => {
    const app = appWith((a) => {
      a.get('/api/things', noop);
      a.post('/api/things', noop);
    });

    expect(Object.keys(openapiDocument(app).paths['/api/things'] ?? {}).sort()).toEqual([
      'get',
      'post',
    ]);
  });

  it('says on the document that it describes requests only', () => {
    // A page silent about responses, with nothing saying why, reads as a page
    // that forgot them. The limit is stated where a reader meets it.
    const doc = openapiDocument(appWith((app) => app.get('/api/things', noop)));

    expect(doc.info.description).toMatch(/README/);
  });

  it('leaves out what is mounted outside the prefix, whatever the walk finds', () => {
    // ADR-0009 puts the scrape and the board outside `/api` because they answer
    // neither this API's envelope nor its content type. Publishing `/metrics`
    // here would promise the envelope for a path that ends a failure with an
    // empty 500, and no parity test could say so: it compares the document with
    // the walk that built it, so both would be wrong together.
    const app = appWith((a) => {
      a.get('/metrics', noop);
      mountAt(a, '/api', Router().get('/things', noop) as never);
    });

    expect(Object.keys(openapiDocument(app).paths)).toEqual(['/api/things']);
  });

  it('walks a mounted router so the document cannot describe fewer routes than the app serves', () => {
    const things = express.Router();
    things.get('/:id', noop);
    const app = appWith((a) => mountAt(a, '/api/things', things));

    expect(Object.keys(openapiDocument(app).paths)).toEqual(['/api/things/{id}']);
  });
});
