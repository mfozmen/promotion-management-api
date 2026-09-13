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
    // The command is checked against the build's own mapping, not a hard-coded `dist/`: moving
    // `outDir` would otherwise leave this green while all three containers crash-loop.
    const options = async (file: string): Promise<Record<string, string>> =>
      (
        JSON.parse(await readFile(new URL(`../../../${file}`, import.meta.url), 'utf8')) as {
          compilerOptions: Record<string, string>;
        }
      ).compilerOptions;
    // `rootDir` is the build config's; `outDir` is inherited from the base it extends.
    const rootDir = (await options('tsconfig.build.json'))['rootDir'];
    const outDir = (await options('tsconfig.json'))['outDir'];
    const command = (await services())[name]?.['command'];
    const script = Array.isArray(command) ? String(command[1]) : '';

    expect(script).toBe(`${outDir}/workers/${name}.js`);
    expect(existsSync(new URL(`../../../${rootDir}/workers/${name}.ts`, import.meta.url))).toBe(
      true,
    );
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

  it('keeps V8 under the container limit, so the cap is an error and not a SIGKILL', async () => {
    // Measured, not assumed: `docker run -m 256m node:22-alpine` reports a heap limit of 259 MB,
    // above the cgroup. Without a lower ceiling the kernel kills the import with no stack, no
    // log line and no exit reason, and `restart: unless-stopped` makes it look slow instead.
    const worker = (await services())['ingestion-worker'] ?? {};
    const options = String((worker['environment'] as Record<string, string>)['NODE_OPTIONS']);
    const heapMiB = Number(/--max-old-space-size=(\d+)/.exec(options)?.[1]);
    const limit = worker['deploy'] as { resources: { limits: { memory: string } } };

    expect(heapMiB).toBeLessThan(Number(limit.resources.limits.memory.replace('M', '')));
  });

  it('gives the ingestion worker the same upload volume the api writes to', async () => {
    // `api` streams the upload to a file and the worker reads it back by `file_ref`; without a
    // shared volume that read is an ENOENT the day the chunk processor lands. The target is
    // taken from each service's own `UPLOAD_DIR`, so a changed directory cannot leave the mount
    // behind while this stays green.
    const mount = async (name: string): Promise<string | undefined> => {
      const service = (await services())[name] ?? {};
      const dir = (service['environment'] as Record<string, string>)['UPLOAD_DIR'];

      return (service['volumes'] as string[] | undefined)?.find((entry) =>
        entry.endsWith(`:${String(dir)}`),
      );
    };

    expect(await mount('ingestion-worker')).toBeDefined();
    expect(await mount('ingestion-worker')).toBe(await mount('api'));
  });

  it('creates the upload directory for the user the image runs as', async () => {
    // A named volume takes its ownership from the image's directory. Without one, Docker makes
    // the mountpoint root-owned and `USER node` gets EACCES on the first upload — a shared
    // volume that reads as correctly configured and cannot be written to. The path comes from
    // compose, so moving `UPLOAD_DIR` cannot leave the chown behind with this still green.
    const dir = String(
      ((await services())['api']?.['environment'] as Record<string, string>)['UPLOAD_DIR'],
    );
    const dockerfile = await readFile(new URL('../../../Dockerfile', import.meta.url), 'utf8');
    const user = /USER (\S+)/.exec(dockerfile)?.[1] ?? '';

    expect(dockerfile).toContain(`chown ${user}:${user} ${dir}`);
    expect(dockerfile.indexOf(`mkdir -p ${dir}`)).toBeLessThan(dockerfile.indexOf('USER '));
  });

  it.each([...WORKERS, 'api'])(
    '%s is given longer to stop than it is given to drain',
    async (name) => {
      // Docker's default grace period is 10 s and the drain budget defaults to 10 s: the timeout
      // that exists to log why a stop is taking so long would race the SIGKILL that ends it.
      // `.env.example` is read too, because that is the file that invites raising the budget.
      // `api` carries the grace period but does not yet spend it as a bound on its queue and
      // pool close (ADR-0003); that belongs to the api's own shutdown.
      const service = (await services())[name] ?? {};
      const grace = Number(String(service['stop_grace_period']).replace('s', ''));
      const environment = service['environment'] as Record<string, string>;
      const example = await readFile(new URL('../../../.env.example', import.meta.url), 'utf8');
      const budgets = [
        /:-(\d+)}/.exec(environment['SHUTDOWN_DRAIN_TIMEOUT_MS'] ?? '')?.[1],
        /^SHUTDOWN_DRAIN_TIMEOUT_MS=(\d+)$/m.exec(example)?.[1],
      ];

      for (const budget of budgets) expect(grace * 1000).toBeGreaterThan(Number(budget));
    },
  );

  it('gives the limit to the ingestion worker alone', async () => {
    // The other two carry no cap on purpose: the case study names one for the import only, and
    // a limit invented for the others would be a number nobody chose.
    const capped = Object.entries(await services())
      .filter(([, service]) => service['deploy'] !== undefined)
      .map(([name]) => name);

    expect(capped).toEqual(['ingestion-worker']);
  });
});
