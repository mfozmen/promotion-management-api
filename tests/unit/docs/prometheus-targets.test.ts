import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { metricsRegistry } from '@src/shared/metrics/metrics-registry.js';
import { queueDepth } from '@src/shared/metrics/queue-depth.js';
import { captureLogger } from '../capture-logger.js';

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

describe('the alert rules', () => {
  const rules = async (): Promise<{ alert: string; expr: string }[]> =>
    (
      parse(await read('monitoring/alerts.yml')) as {
        groups: { rules: { alert: string; expr: string }[] }[];
      }
    ).groups.flatMap((group) => group.rules);

  it('is loaded by Prometheus and mounted into its container', async () => {
    // A rule file nothing reads looks exactly like one that fires nothing.
    const config = parse(await read('monitoring/prometheus.yml')) as { rule_files?: string[] };
    const volumes = (await compose()).services['prometheus']?.['volumes'] as string[];

    expect(config.rule_files).toContain('alerts.yml');
    expect(volumes.some((v) => v.includes('alerts.yml'))).toBe(true);
  });

  it('alerts only on metrics something actually emits', async () => {
    // The gap this closes: a rule naming a metric no process exports is silent
    // for ever and reads as a system that is never in trouble. The names come from
    // the registry the processes register on, not from a list written here: a list
    // written here stays true after the code that emits the metric is deleted.
    await import('@src/app.js');
    await import('@src/shared/metrics/drift-repairs.js');
    queueDepth(
      {
        inspect: () => ({
          getWaitingCount: () => Promise.resolve(0),
          getFailedCount: () => Promise.resolve(0),
        }),
      },
      ['promotions'],
      captureLogger().logger,
    );
    const emitted = (await metricsRegistry.getMetricsAsJSON()).flatMap(({ name, type }) =>
      // A histogram is scraped under its suffixes, never under its own name.
      // Compared as a string because prom-client's own typings declare `type` a
      // numeric enum while it returns the name at runtime.
      String(type) === 'histogram' ? [`${name}_count`, `${name}_bucket`, `${name}_sum`] : [name],
    );

    const parsed = await rules();
    // A loop over an empty list passes whatever the list should have contained;
    // these are the assertions that make the one below capable of failing.
    expect(parsed.length).toBeGreaterThan(4);
    expect(emitted.length).toBeGreaterThan(10);

    for (const { alert, expr } of parsed) {
      // Label selectors go first: `status_code` inside `{}` is a label, not a
      // series, and a matcher that cannot tell them apart fails on correct rules.
      const named = [...expr.replaceAll(/[{][^}]*[}]/g, '').matchAll(/([a-z_][a-z0-9_]*)/g)]
        .map((match) => match[1] ?? '')
        .filter((name) => name.includes('_') || name === 'up')
        // PromQL's own functions and template variables are not series, and `up`
        // is synthesized by Prometheus for every target rather than exported.
        .filter(
          (name) =>
            !['histogram_quantile', 'humanizePercentage', 'labels', 'value', 'up'].includes(name),
        );
      const unknown = named.filter((name) => !emitted.includes(name));

      expect({ alert, unknown }).toEqual({ alert, unknown: [] });
    }
  });

  it('keeps the reconciler the process that reports the depths', async () => {
    // The only check there is: the wiring line lives in an entry point coverage
    // excludes, so deleting it breaks no test and leaves the two queue rules
    // reading a metric nobody exports.
    const wiring = await read('src/workers/reconciler.ts');

    // Matched loosely: a re-wrap of that call would fail an exact substring with
    // no behaviour change.
    expect(wiring).toMatch(/queueDepth\(\s*queue,/);
    for (const queue of ['promotions', 'products', 'ingestion', 'maintenance']) {
      expect(wiring).toContain(`'${queue}'`);
    }
  });

  it('says what to do, not only what happened', async () => {
    const parsed = parse(await read('monitoring/alerts.yml')) as {
      groups: { rules: { alert: string; annotations?: Record<string, string> }[] }[];
    };

    for (const rule of parsed.groups.flatMap((group) => group.rules)) {
      expect({ alert: rule.alert, described: Boolean(rule.annotations?.description) }).toEqual({
        alert: rule.alert,
        described: true,
      });
    }
  });
});
