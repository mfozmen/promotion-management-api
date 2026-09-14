import { Counter } from 'prom-client';
import { metricsRegistry } from './metrics-registry.js';

/**
 * How many categories the reconciler has rebuilt because the two stores disagreed.
 * A counter rather than a gauge: the alert is on it increasing at all, since a
 * healthy system repairs nothing and one repair is already worth a look.
 */
export const driftRepairs = new Counter({
  name: 'readmodel_drift_repairs_total',
  help: 'Categories rebuilt because Redis and PostgreSQL disagreed on their size',
  registers: [metricsRegistry],
});
