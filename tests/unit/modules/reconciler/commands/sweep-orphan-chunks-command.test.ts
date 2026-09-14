import { describe, expect, it, vi } from 'vitest';
import { SweepOrphanChunksCommand } from '@src/modules/reconciler/commands/sweep-orphan-chunks-command.js';
import { captureLogger } from '../../../capture-logger.js';

function collaborators(orphans: { jobId: number; chunkIndex: number }[], settled: number[] = []) {
  const chunks = {
    orphaned: vi.fn().mockResolvedValue(orphans),
    settleFinishedJobs: vi.fn().mockResolvedValue(settled),
  };
  const queue = { publish: vi.fn().mockResolvedValue(undefined) };
  const { logger, lines } = captureLogger();

  return { chunks, queue, logger, lines };
}

const sweepOf = (c: ReturnType<typeof collaborators>) =>
  new SweepOrphanChunksCommand(c.chunks, c.queue, c.logger);

describe('SweepOrphanChunksCommand', () => {
  it('gives every abandoned chunk a worker to pick it up', async () => {
    const c = collaborators([
      { jobId: 1, chunkIndex: 0 },
      { jobId: 1, chunkIndex: 3 },
    ]);

    await expect(sweepOf(c).execute()).resolves.toBe(2);

    expect(vi.mocked(c.queue.publish).mock.calls).toEqual([
      ['chunk.process', { jobId: 1, chunkIndex: 0 }, { jobId: 'chunk:1:0' }],
      ['chunk.process', { jobId: 1, chunkIndex: 3 }, { jobId: 'chunk:1:3' }],
    ]);
  });

  it('settles a job whose chunks all finished, which is what frees the vendor', async () => {
    const c = collaborators([], [7]);

    await sweepOf(c).execute();

    // The unique index is on `status in ('running','paused')`, so a job left
    // running with no work holds the vendor's next import out for ever.
    expect(c.chunks.settleFinishedJobs).toHaveBeenCalledOnce();
    expect(c.lines.at(-1)).toMatchObject({ settled: [7] });
  });

  it('does nothing and says nothing when no import is stuck', async () => {
    const c = collaborators([]);

    await expect(sweepOf(c).execute()).resolves.toBe(0);

    expect(c.queue.publish).not.toHaveBeenCalled();
    expect(c.lines).toEqual([]);
  });

  it('keeps sweeping after one publish fails, so one bad chunk cannot strand the rest', async () => {
    const c = collaborators([
      { jobId: 1, chunkIndex: 0 },
      { jobId: 2, chunkIndex: 0 },
    ]);
    vi.mocked(c.queue.publish).mockRejectedValueOnce(new Error('queue down'));

    await expect(sweepOf(c).execute()).resolves.toBe(1);

    expect(c.queue.publish).toHaveBeenCalledTimes(2);
    expect(c.lines[0]).toMatchObject({ level: 50, jobId: 1, chunkIndex: 0 });
  });
});
