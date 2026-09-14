import { Counter } from 'prom-client';
import { metricsRegistry } from './metrics-registry.js';

/**
 * What the reconciler re-emitted, per run. The e2e case asserts exactly one repair per boundary,
 * and a sweep that logs only that it ran cannot answer that (ADR-0007).
 */
export const boundaryRepairs = new Counter({
  name: 'reconciler_boundary_repairs_total',
  help: 'Promotions re-announced by the boundary sweep',
  registers: [metricsRegistry],
});
