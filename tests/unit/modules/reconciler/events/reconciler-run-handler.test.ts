import { describe, expect, it, vi } from 'vitest';
import { ReconcilerRunHandler } from '@src/modules/reconciler/events/reconciler-run-handler.js';
import { captureLogger } from '../../../capture-logger.js';

const ran = (n = 0) => ({ execute: vi.fn<() => Promise<number>>().mockResolvedValue(n) });
const failing = (why: string) => ({
  execute: vi.fn<() => Promise<number>>().mockRejectedValue(new Error(why)),
});

describe('ReconcilerRunHandler', () => {
  it('sweeps abandoned imports on every run, which is the thing nothing asked for', async () => {
    const chunks = ran(3);

    await new ReconcilerRunHandler(ran(), chunks, ran(), captureLogger().logger).handle();

    // A worker can already re-claim an expired lease; until this call existed
    // nothing ever gave one a reason to try, so a vendor whose import died
    // stayed locked out for ever (issue #134).
    expect(chunks.execute).toHaveBeenCalledOnce();
  });

  it('lets a failing import sweep reach BullMQ, so the job is recorded as failed', async () => {
    await expect(
      new ReconcilerRunHandler(
        ran(),
        failing('queue down'),
        ran(),
        captureLogger().logger,
      ).handle(),
    ).rejects.toThrow('queue down');
  });

  it('sweeps before it looks for drift', async () => {
    // The other order compares a read model the sweep has not finished repairing,
    // so a stale entry the queue was about to fix reads as a lost write.
    const order: string[] = [];
    const sweep = { execute: vi.fn(async () => (order.push('sweep'), 0)) };
    const drift = { execute: vi.fn(async () => (order.push('drift'), 0)) };

    await new ReconcilerRunHandler(sweep, ran(), drift, captureLogger().logger).handle();

    expect(order).toEqual(['sweep', 'drift']);
  });

  it('says how many categories the drift check repaired, and stays quiet when none did', async () => {
    const { logger, lines } = captureLogger();

    await new ReconcilerRunHandler(ran(), ran(), ran(2), logger).handle();
    await new ReconcilerRunHandler(ran(), ran(), ran(0), logger).handle();

    expect(lines.filter((line) => String(line.msg).includes('drift check'))).toHaveLength(1);
  });

  it('lets a failing sweep reach BullMQ, so the job is recorded as failed', async () => {
    // Swallowing here would leave the watermark unmoved and nothing in the failed set:
    // the repair would stop running and no one would be told (ADR-0007).
    await expect(
      new ReconcilerRunHandler(failing('down'), ran(), ran(), captureLogger().logger).handle(),
    ).rejects.toThrow('down');
  });

  it('lets a failing drift check reach BullMQ too', async () => {
    // A run that repaired nothing and returned looks exactly like one with
    // nothing to repair.
    await expect(
      new ReconcilerRunHandler(
        ran(),
        ran(),
        failing('redis gone'),
        captureLogger().logger,
      ).handle(),
    ).rejects.toThrow('redis gone');
  });
});
