import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '@src/app.js';
import { isDocumented } from '@src/shared/http/documented-scope.js';
import { openapiDocument } from '@src/shared/http/openapi-document.js';
import { routeInventory } from '@src/shared/http/route-inventory.js';
import { appDeps } from '@tests/app-deps.js';

/**
 * Routes that validate nothing, each because it takes no input worth parsing.
 * Any other route without schemas is a route the document describes less than
 * the API serves, which is the drift this whole document exists to prevent.
 */
const TAKES_NO_INPUT = new Set([
  'get /api/health',
  'get /api/ready',
  'get /api/openapi.json',
  // multipart, bounded by multer rather than by a zod schema; the document
  // cannot describe it until the upload is validated by a schema too.
  'post /api/vendor/imports',
]);

const app = (): ReturnType<typeof createApp> => createApp(appDeps());

describe('the document and the application', () => {
  it('describes exactly the routes the application answers', () => {
    const served = routeInventory(app())
      .map((route) => route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'))
      .filter(isDocumented);

    const documented = Object.keys(openapiDocument(app()).paths);

    expect([...new Set(documented)].sort()).toEqual([...new Set(served)].sort());
  });

  it('leaves no route validating nothing except the ones that take nothing', () => {
    // This is the fence: a route added later without a schema lands here as a
    // failure naming itself, rather than as a document that quietly says less.
    const unvalidated = routeInventory(app())
      .filter((route) => Object.keys(route.schemas).length === 0)
      .map((route) => `${route.method} ${route.path}`)
      .filter((route) => isDocumented(route.slice(route.indexOf(' ') + 1)))
      .filter((route) => !TAKES_NO_INPUT.has(route));

    expect(unvalidated).toEqual([]);
  });

  it('documents every path the README table lists, and lists every path it documents', () => {
    // The one assertion here whose expectation does not come from the generator.
    // Both sides of every other check are the same reading of the application,
    // so they agree even when both are wrong; the table is written by a person
    // and can disagree (REVIEW.md 13.12, 13.16).
    const readme = readFileSync(new URL('../../../../README.md', import.meta.url), 'utf8');
    const endpoints = readme.slice(readme.indexOf('## Endpoints'));
    const table = endpoints
      .slice(0, endpoints.indexOf('\n## '))
      .split('\n')
      .filter((line) => line.startsWith('| '))
      .map((line) => /`(\/api\/[^`]*)`/.exec(line)?.[1])
      .filter((path): path is string => path !== undefined)
      .map((path) => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'))
      .filter(isDocumented);

    const documented = Object.keys(openapiDocument(app()).paths);

    expect([...new Set(table)].sort()).toEqual([...new Set(documented)].sort());
  });

  it('publishes nothing mounted outside the prefix', () => {
    // `/metrics` was in the document promising the shared error envelope, which
    // it never answers: its failure is an empty 500 (ADR-0009). No parity test
    // could catch that, because the document and the list it is checked against
    // come from the same walk — both were wrong in the same direction.
    const documented = Object.keys(openapiDocument(app()).paths);

    expect(documented.filter((path) => !path.startsWith('/api'))).toEqual([]);
    expect(documented).not.toContain('/metrics');
  });
});

describe('GET /api/openapi.json', () => {
  it('serves the document, including the routes mounted after it', async () => {
    // The document is built per request rather than at mount time: taken then,
    // it would describe only what had been mounted before this route.
    const res = await request(app()).get('/api/openapi.json');

    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths)).toContain('/api/promotions/{id}/assign');
  });

  it('describes the error envelope the API actually sends', async () => {
    // Issue #2 asks for `{ error: { code, message, details? } }`; ADR-0009 settled
    // on `{ error: { message } }` and that is what every path answers, so the
    // document follows the code rather than the issue.
    const res = await request(app()).get('/api/openapi.json');

    expect(res.body.components.schemas.Error.properties.error.properties).toEqual({
      message: { type: 'string' },
    });
  });
});

describe('GET /api/docs', () => {
  it('serves Swagger UI', async () => {
    const res = await request(app()).get('/api/docs/');

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/swagger-ui/i);
  });

  it('points the page at the document this API serves', async () => {
    // The URL lives in the init script the page loads, not in the page: the UI
    // fetches the document rather than rendering a copy baked in at mount time.
    const res = await request(app()).get('/api/docs/swagger-ui-init.js');

    expect(res.status).toBe(200);
    expect(res.text).toContain('/api/openapi.json');
  });
});
