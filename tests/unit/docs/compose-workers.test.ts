import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * The compose file is parsed rather than read. Two services once landed under `networks:`
 * instead of `services:` and the file looked right; a YAML key in the wrong place is invisible
 * to a reader and obvious to a parser.
 */
async function services(): Promise<Record<string, Record<string, unknown>>> {
  const file = await readFile(new URL('../../../docker-compose.yml', import.meta.url), 'utf8');

  return (parse(file) as { services: Record<string, Record<string, unknown>> }).services;
}

const WORKERS = ['event-handler', 'ingestion-worker', 'reconciler'] as const;

describe('the worker services', () => {
  it.each(WORKERS)('%s is a service, not something nested under another key', async (name) => {
    expect(Object.keys(await services())).toContain(name);
  });

  it.each(WORKERS)('%s runs a command whose entry point exists in src/', async (name) => {
    // `dist/workers/x.js` is `src/workers/x.ts` after the build, so a rename that misses one
    // of the two files fails here rather than crash-looping in a container.
    const command = (await services())[name]?.['command'];
    const script = Array.isArray(command) ? String(command[1]) : '';

    expect(script).toBe(`dist/workers/${name}.js`);
    expect(existsSync(new URL(`../../../src/workers/${name}.ts`, import.meta.url))).toBe(true);
  });

  it.each(WORKERS)('%s waits for the migrator, not just for the stores', async (name) => {
    // `api` is the only migrator (ADR-0003): waiting on postgres alone would let a worker
    // connect before the schema exists.
    const dependsOn = (await services())[name]?.['depends_on'] as Record<string, unknown>;

    expect(Object.keys(dependsOn).sort()).toEqual(['api', 'postgres', 'redis']);
  });

  it('holds the ingestion worker to the case study 256 MiB and 0.5 CPU', async () => {
    // Scenario A's claim is that a 500 000-row import survives this cap, and #20's measurement
    // is taken against it — a service that starts without the limit measures nothing.
    const deploy = (await services())['ingestion-worker']?.['deploy'] as {
      resources: { limits: { memory: string; cpus: string } };
    };

    expect(deploy.resources.limits).toEqual({ memory: '256M', cpus: '0.5' });
  });

  it('gives the limit to the ingestion worker alone', async () => {
    // The other two carry no cap on purpose: the case study names one for the import only, and
    // a limit invented for the others would be a number nobody chose.
    const capped = Object.entries(await services())
      .filter(([, service]) => service['deploy'] !== undefined)
      .map(([name]) => name);

    expect(capped).toEqual(['ingestion-worker']);
  });
});
