import { Gauge } from 'prom-client';
import type { DependencyStatus } from '../dependency-readiness.js';
import { metricsRegistry } from './metrics-registry.js';

interface Readiness {
  check(): Promise<DependencyStatus>;
}

/**
 * The same question `/api/ready` answers, asked on every scrape instead of only when someone
 * looks. That is the difference between knowing the stack is reachable now and being able to say
 * afterwards whether it was reachable during a run — which is what a scenario report needs, since
 * nobody is watching the route while `autocannon` is going.
 */
export function dependencyUp(readiness: Readiness): void {
  if (metricsRegistry.getSingleMetric('dependency_up') !== undefined) return;

  new Gauge({
    name: 'dependency_up',
    help: 'Whether this process could reach each store at scrape time',
    labelNames: ['dependency'],
    registers: [metricsRegistry],
    async collect() {
      const status = await readiness.check();
      this.set({ dependency: 'postgres' }, status.postgres === 'up' ? 1 : 0);
      this.set({ dependency: 'redis' }, status.redis === 'up' ? 1 : 0);
    },
  });
}
