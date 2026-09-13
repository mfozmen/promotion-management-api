import { readFileSync } from 'node:fs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { appDeps } from '@tests/app-deps.js';
import { createApp } from '@src/app.js';

/**
 * The compose healthcheck and the route it fetches are written in two files that
 * no diff compares. Moving the probe under `/api` left compose fetching the old
 * path: both files were individually correct, the textual diff against `main` was
 * empty because this branch never edited compose, and the container would simply
 * never have reported healthy — `up --wait` hanging rather than failing.
 */
const compose = readFileSync(new URL('../../../docker-compose.yml', import.meta.url), 'utf8');

function probePath(): string {
  const match = /fetch\('http:\/\/[^/]+(\/[^']*)'\)/.exec(compose);
  if (!match?.[1]) throw new Error('no healthcheck fetch found in docker-compose.yml');
  return match[1];
}

describe('the api healthcheck', () => {
  it('fetches a path the application actually serves', async () => {
    const res = await request(createApp(appDeps())).get(probePath());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('is the /api-prefixed probe, since every route is mounted there', () => {
    expect(probePath()).toBe('/api/health');
  });
});
