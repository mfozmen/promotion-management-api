import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const read = async (file: string): Promise<string> =>
  readFile(new URL(`../../../${file}`, import.meta.url), 'utf8');

const compose = async (): Promise<{ services: Record<string, Record<string, unknown>> }> =>
  parse(await read('docker-compose.yml'), { merge: true }) as {
    services: Record<string, Record<string, unknown>>;
  };

const targets = async (): Promise<string[]> =>
  (
    parse(await read('monitoring/prometheus.yml')) as {
      scrape_configs: { static_configs: { targets: string[] }[] }[];
    }
  ).scrape_configs.flatMap((job) => job.static_configs.flatMap((entry) => entry.targets));

describe('the Prometheus targets', () => {
  it('scrapes every process that serves metrics, and nothing else', async () => {
    const hosts = (await targets()).map((target) => target.split(':')[0]);

    expect(hosts.sort()).toEqual(['api', 'event-handler', 'ingestion-worker', 'reconciler']);
  });

  it('scrapes each one on the port that service actually listens on', async () => {
    // Two files that must agree and no runtime check between them: raising
    // `WORKER_METRICS_PORT` moves the workers and leaves Prometheus scraping 3101, which shows up
    // as three DOWN targets long after the run whose numbers were wanted.
    const services = (await compose()).services;
    const listensOn = (name: string): number => {
      const service = services[name] ?? {};
      const environment = service['environment'] as Record<string, string>;
      const published = (service['ports'] as string[] | undefined)?.[0];

      // The api publishes its own port; a worker's metrics port is internal to the network.
      return published === undefined
        ? Number(/:-(\d+)}/.exec(environment['WORKER_METRICS_PORT'] ?? '')?.[1])
        : Number(published.split(':').pop());
    };

    for (const target of await targets()) {
      const [host, port] = target.split(':');

      expect(port).toBe(String(listensOn(String(host))));
    }
  });
});
