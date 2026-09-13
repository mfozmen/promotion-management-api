import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../src/shared/logger.js';
import { EventQueue } from '../../../src/shared/queue/event-queue.js';
import { startWorker } from '../../../src/workers/start-worker.js';

/** The three entry points are two lines each; everything they do is here, so this covers them. */
describe('startWorker', () => {
  const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const listeners = process.listeners('SIGTERM');

  beforeEach(() => {
    // `loadConfig` reads the environment the container provides; these are the four the
    // compose services set.
    vi.stubEnv('DATABASE_URL', 'postgres://promo:promo@postgres:5432/promotion');
    vi.stubEnv('REDIS_URL', 'redis://redis:6379');
    vi.stubEnv('REDIS_QUEUE_DB', '1');
    vi.stubEnv('SHUTDOWN_DRAIN_TIMEOUT_MS', '10000');
    close.mockReset().mockResolvedValue(undefined);
    vi.spyOn(EventQueue, 'connect').mockReturnValue({ close } as unknown as EventQueue<never>);
  });

  afterEach(() => {
    // A `process.once` per test would otherwise outlive it and fire on every later emit.
    for (const listener of process.listeners('SIGTERM')) {
      if (!listeners.includes(listener)) process.removeListener('SIGTERM', listener);
    }
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('connects the queue on the configured Redis database', () => {
    startWorker('event-handler');

    expect(EventQueue.connect).toHaveBeenCalledWith(
      'redis://redis:6379',
      1,
      expect.anything(),
      expect.anything(),
    );
  });

  it('says which worker it is and that nothing is consuming', () => {
    const info = vi.spyOn(logger, 'info');

    startWorker('reconciler');

    expect(info).toHaveBeenCalledWith(
      { worker: 'reconciler' },
      expect.stringContaining('no consumer'),
    );
  });

  it('closes the queue on SIGTERM', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    startWorker('ingestion-worker');
    process.emit('SIGTERM');
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0);
    });

    expect(close).toHaveBeenCalledOnce();
  });

  it('gives up on a close that never settles rather than waiting for SIGKILL', async () => {
    // Redis unreachable at `docker compose stop`: `close()` never resolves, and an unbounded
    // await means Docker kills the process 10 s later with no line saying why.
    close.mockReturnValue(new Promise(() => undefined));
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const warn = vi.spyOn(logger, 'warn');
    vi.useFakeTimers();

    startWorker('event-handler');
    process.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(10_000);
    vi.useRealTimers();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not close'));
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits non-zero when the close fails, so the restart is not silent', async () => {
    close.mockRejectedValue(new Error('connection lost'));
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    startWorker('reconciler');
    process.emit('SIGTERM');
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(1);
    });
  });
});
