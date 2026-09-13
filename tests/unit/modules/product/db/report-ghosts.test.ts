import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

/** The window is module state, so each case gets its own copy of the module —
 *  and its own logger, which is the one the spy has to watch. */
async function freshReportGhosts(): Promise<{
  reportGhosts: (key: string, absent: number) => void;
  warn: MockInstance;
}> {
  vi.resetModules();
  const { logger } = await import('@src/shared/logger.js');
  const { reportGhosts } = await import('@src/modules/product/db/report-ghosts.js');

  return { reportGhosts, warn: vi.spyOn(logger, 'warn').mockReturnValue(undefined) };
}

describe('reportGhosts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('writes one line for a burst rather than one per request', async () => {
    const { reportGhosts, warn } = await freshReportGhosts();

    for (let i = 0; i < 500; i += 1) reportGhosts('products:knitwear', 3);

    // A 50 000-product recompute makes every request in the category see this,
    // and that is when the storefront is busiest.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ requests: 1, missing: 3 });
  });

  it('reports the burst it swallowed when the window closes', async () => {
    const { reportGhosts, warn } = await freshReportGhosts();
    for (let i = 0; i < 500; i += 1) reportGhosts('products:knitwear', 3);

    vi.advanceTimersByTime(10_000);
    reportGhosts('products:knitwear', 2);

    expect(warn).toHaveBeenCalledTimes(2);
    // The count covers the whole window, not the one request that reopened it,
    // or the line understates the rebuild by a factor of the load.
    expect(warn.mock.calls[1]?.[0]).toMatchObject({ requests: 500, missing: 1499 });
  });
});
