import { describe, expect, it, vi } from 'vitest';
import { dependencyUp } from '@src/shared/metrics/dependency-up.js';
import { metricsRegistry } from '@src/shared/metrics/metrics-registry.js';

describe('dependencyUp', () => {
  it('asks the stores on every scrape, so a report can say whether they were up during a run', async () => {
    const check = vi
      .fn<() => Promise<{ postgres: 'up' | 'down'; redis: 'up' | 'down' }>>()
      .mockResolvedValue({ postgres: 'up', redis: 'down' });
    dependencyUp({ check });

    const scraped = await metricsRegistry.metrics();

    expect(scraped).toContain('dependency_up{dependency="postgres"} 1');
    expect(scraped).toContain('dependency_up{dependency="redis"} 0');
    expect(check).toHaveBeenCalledOnce();
  });
});
