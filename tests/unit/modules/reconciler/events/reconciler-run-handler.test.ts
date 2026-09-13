import { describe, expect, it, vi } from 'vitest';
import { ReconcilerRunHandler } from '@src/modules/reconciler/events/reconciler-run-handler.js';

describe('ReconcilerRunHandler', () => {
  it('runs the sweep', async () => {
    const sweep = { execute: vi.fn<() => Promise<number>>().mockResolvedValue(0) };

    await new ReconcilerRunHandler(sweep).handle();

    expect(sweep.execute).toHaveBeenCalledOnce();
  });

  it('lets a failing sweep reach BullMQ, so the job is recorded as failed', async () => {
    // Swallowing here would leave the watermark unmoved and nothing in the failed set:
    // the repair would stop running and no one would be told (ADR-0007).
    const sweep = { execute: vi.fn<() => Promise<number>>().mockRejectedValue(new Error('down')) };

    await expect(new ReconcilerRunHandler(sweep).handle()).rejects.toThrow('down');
  });
});
