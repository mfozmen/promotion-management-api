import { describe, expect, it, vi } from 'vitest';
import { ReconcilerRunHandler } from '@src/modules/reconciler/events/reconciler-run-handler.js';
import { boundaryRepairs } from '@src/shared/metrics/boundary-repairs.js';
import { metricsRegistry } from '@src/shared/metrics/metrics-registry.js';

describe('ReconcilerRunHandler', () => {
  it('counts what the sweep repaired, so a scrape can answer "one per boundary"', async () => {
    metricsRegistry.resetMetrics();
    const sweep = { execute: vi.fn<() => Promise<number>>().mockResolvedValue(4) };

    await new ReconcilerRunHandler(sweep).handle('reconciler.run');

    expect(await boundaryRepairs.get()).toMatchObject({ values: [{ value: 4 }] });
  });

  it('runs the sweep', async () => {
    const sweep = { execute: vi.fn<() => Promise<number>>().mockResolvedValue(0) };

    await new ReconcilerRunHandler(sweep).handle('reconciler.run');

    expect(sweep.execute).toHaveBeenCalledOnce();
  });

  it('refuses a job it has no handler for rather than acknowledging it', async () => {
    // `readmodel.rebuild` shares the `maintenance` queue. Returning would mark it done and the
    // rebuild would never run; failing puts it in the dead-letter set where it can be seen.
    const sweep = { execute: vi.fn<() => Promise<number>>().mockResolvedValue(0) };

    await expect(new ReconcilerRunHandler(sweep).handle('readmodel.rebuild')).rejects.toThrow(
      'no handler for readmodel.rebuild',
    );
    expect(sweep.execute).not.toHaveBeenCalled();
  });

  it('lets a failing sweep reach BullMQ, so the job is recorded as failed', async () => {
    // Swallowing here would leave the watermark unmoved and nothing in the failed set:
    // the repair would stop running and no one would be told (ADR-0007).
    const sweep = { execute: vi.fn<() => Promise<number>>().mockRejectedValue(new Error('down')) };

    await expect(new ReconcilerRunHandler(sweep).handle('reconciler.run')).rejects.toThrow('down');
  });
});
