import { afterEach, describe, expect, it, vi } from 'vitest';
import { dependencyUp } from '@src/shared/metrics/dependency-up.js';
import { metricsRegistry } from '@src/shared/metrics/metrics-registry.js';

describe('dependencyUp', () => {
  afterEach(() => {
    metricsRegistry.removeSingleMetric('dependency_up');
  });

  it('reports a store that did not answer as 0, which is what an alert reads', async () => {
    const check = vi
      .fn<() => Promise<{ postgres: 'up' | 'down'; redis: 'up' | 'down' }>>()
      .mockResolvedValue({ postgres: 'down', redis: 'down' });
    dependencyUp({ check });

    const scraped = await metricsRegistry.metrics();

    expect(scraped).toContain('dependency_up{dependency="postgres"} 0');
    expect(scraped).toContain('dependency_up{dependency="redis"} 0');
  });

  it('asks the stores on every scrape, so a report can say whether they were up during a run', async () => {
    const check = vi
      .fn<() => Promise<{ postgres: 'up' | 'down'; redis: 'up' | 'down' }>>()
      .mockResolvedValue({ postgres: 'up', redis: 'up' });
    dependencyUp({ check });

    const scraped = await metricsRegistry.metrics();

    expect(scraped).toContain('dependency_up{dependency="postgres"} 1');
    expect(scraped).toContain('dependency_up{dependency="redis"} 1');
    expect(check).toHaveBeenCalledOnce();
  });
});
