import { describe, expect, it } from 'vitest';
import { driftRepairs } from '@src/shared/metrics/drift-repairs.js';
import { metricsRegistry } from '@src/shared/metrics/metrics-registry.js';

describe('driftRepairs', () => {
  it('is a counter on the process registry, so a scrape carries it', async () => {
    // A counter rather than a gauge: the alert is on it increasing at all, and a
    // gauge that fell back to zero between scrapes would hide the repair entirely.
    driftRepairs.inc();

    const scrape = await metricsRegistry.metrics();

    expect(scrape).toContain('readmodel_drift_repairs_total 1');
  });
});
