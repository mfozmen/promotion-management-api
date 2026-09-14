import { afterEach, describe, expect, it, vi } from 'vitest';
import { exitIfHeapExceeded } from '@src/workers/exit-if-heap-exceeded.js';
import { logger } from '@src/shared/logger.js';

const heapAt = (bytes: number): void => {
  vi.spyOn(process, 'memoryUsage').mockReturnValue({
    heapUsed: bytes,
    rss: bytes * 4,
  } as ReturnType<typeof process.memoryUsage>);
};

describe('exitIfHeapExceeded', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing while the heap is under the limit', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    heapAt(25 * 1024 * 1024);

    exitIfHeapExceeded('ingestion-worker', 160 * 1024 * 1024);

    expect(exit).not.toHaveBeenCalled();
  });

  it('exits non-zero once it is over, so the orchestrator restarts it', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const warn = vi.spyOn(logger, 'warn');
    heapAt(200 * 1024 * 1024);

    exitIfHeapExceeded('ingestion-worker', 160 * 1024 * 1024);

    expect(warn).toHaveBeenCalledWith(
      { worker: 'ingestion-worker', heapUsed: 200 * 1024 * 1024, limitBytes: 160 * 1024 * 1024 },
      expect.stringContaining('heap over the limit'),
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('reads the heap and not RSS, which is the guard ADR-0005 rejected', () => {
    // `heapAt` sets RSS to four times the heap: a guard reading RSS would fire here, and this
    // one must not, because Node RSS does not shrink and would either never fire or always.
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    heapAt(50 * 1024 * 1024);

    exitIfHeapExceeded('ingestion-worker', 160 * 1024 * 1024);

    expect(exit).not.toHaveBeenCalled();
  });
});
