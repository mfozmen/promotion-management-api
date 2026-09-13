import { readFileSync } from 'node:fs';
import request from 'supertest';
import { parse } from 'yaml';
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

describe('every PostgreSQL healthcheck', () => {
  // `pg_isready` exits 0 for a server that is up and holds no such database, and
  // `POSTGRES_DB` is honoured only when the volume is initialised — so a store whose
  // database name changed reports healthy and fails the first query (REVIEW.md 13.13,
  // ADR-0003). The check has to name the database it is certifying.
  const services = (
    parse(compose) as {
      services: Record<string, { image?: string; healthcheck?: { test: string[] } }>;
    }
  ).services;
  const stores = Object.entries(services).filter(([, service]) =>
    service.image?.startsWith('postgres'),
  );

  it('covers both stores, so neither can be added without one', () => {
    expect(stores.map(([name]) => name).sort()).toEqual(['postgres', 'postgres-test']);
  });

  it.each(stores)(
    '%s queries its own database rather than asking whether the server is up',
    (_name, service) => {
      const test = (service.healthcheck?.test ?? []).join(' ');

      expect(test).toContain('-d "$$POSTGRES_DB"');
      expect(test).not.toContain('pg_isready');
      // Over TCP rather than the local socket: during `initdb` the entrypoint runs its own
      // temporary server with `listen_addresses=''`, so a socket check can report healthy
      // before the server a consumer connects to exists.
      expect(test).toContain('-h 127.0.0.1');
    },
  );
});
