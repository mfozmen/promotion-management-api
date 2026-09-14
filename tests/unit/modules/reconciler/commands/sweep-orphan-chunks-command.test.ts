import { describe, expect, it, vi } from 'vitest';
import { SweepOrphanChunksCommand } from '@src/modules/reconciler/commands/sweep-orphan-chunks-command.js';
import { captureLogger } from '../../../capture-logger.js';

const GRACE_MS = 90_000;

function collaborators(orphans: { jobId: number; chunkIndex: number }[], settled: number[] = []) {
  const chunks = {
    orphaned: vi.fn().mockResolvedValue(orphans),
    runningJobIds: vi.fn().mockResolvedValue(settled),
  };
  const imports = {
    completeJobIfDone: vi.fn().mockResolvedValue(true),
    failJobIfExhausted: vi.fn().mockResolvedValue(false),
  };
  const queue = { publish: vi.fn().mockResolvedValue(undefined) };
  const { logger, lines } = captureLogger();

  return { chunks, imports, queue, logger, lines };
}

const sweepOf = (c: ReturnType<typeof collaborators>) =>
  new SweepOrphanChunksCommand(c.chunks, c.imports, c.queue, GRACE_MS, c.logger);

describe('SweepOrphanChunksCommand', () => {
  it('gives every abandoned chunk a worker to pick it up', async () => {
    const c = collaborators([
      { jobId: 1, chunkIndex: 0 },
      { jobId: 1, chunkIndex: 3 },
    ]);

    await expect(sweepOf(c).execute()).resolves.toBe(2);

    expect(vi.mocked(c.queue.publish).mock.calls).toEqual([
      ['chunk.process', { jobId: 1, chunkIndex: 0 }],
      ['chunk.process', { jobId: 1, chunkIndex: 3 }],
    ]);
  });

  it('settles a job whose chunks all finished, which is what frees the vendor', async () => {
    const c = collaborators([], [7]);

    await sweepOf(c).execute();

    // The unique index is on `status in ('running','paused')`, so a job left
    // running with no work holds the vendor's next import out for ever.
    expect(c.imports.completeJobIfDone).toHaveBeenCalledWith(7);
    expect(c.lines.at(-1)).toMatchObject({ settled: [7] });
  });

  it('names no job id, so a second sweep of one chunk is not deduplicated away', async () => {
    const c = collaborators([{ jobId: 1, chunkIndex: 0 }]);

    await sweepOf(c).execute();
    await sweepOf(c).execute();

    // BullMQ keeps completed keys and every failed one, and an add that
    // collides returns the old job instead of queueing one: a stable id would
    // work once and then silently stop, on the chunk that needed it most.
    expect(vi.mocked(c.queue.publish).mock.calls.every((call) => call.length === 2)).toBe(true);
    expect(c.queue.publish).toHaveBeenCalledTimes(2);
  });

  it('gives up on a job whose chunks have all spent their attempts', async () => {
    const c = collaborators([], [9]);
    c.imports.completeJobIfDone.mockResolvedValue(false);
    c.imports.failJobIfExhausted.mockResolvedValue(true);

    await sweepOf(c).execute();

    // Leaving it `running` is the lockout by another road: a vendor waiting on
    // work that can never be done.
    expect(c.lines.at(-1)).toMatchObject({ givenUp: [9] });
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
