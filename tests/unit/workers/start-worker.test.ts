import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../src/shared/logger.js';
import { EventQueue } from '../../../src/shared/queue/event-queue.js';
import { startWorker } from '../../../src/workers/start-worker.js';

/** The three entry points are two lines each plus their wiring; this is what they all run. */
describe('startWorker', () => {
  const close = vi.fn<() => Promise<void>>();
  const listeners = process.listeners('SIGTERM');

  beforeEach(() => {
    // `loadConfig` reads the environment the container provides; these are the four the
    // compose services set.
    vi.stubEnv('DATABASE_URL', 'postgres://promo:promo@postgres:5432/promotion');
    vi.stubEnv('REDIS_URL', 'redis://redis:6379');
    vi.stubEnv('REDIS_QUEUE_DB', '1');
    vi.stubEnv('SHUTDOWN_DRAIN_TIMEOUT_MS', '10000');
    // `restoreAllMocks` resets a plain `vi.fn`, so the default belongs per test.
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

  it('says which queues it drains, so an idle one is not read as drained', () => {
    const info = vi.spyOn(logger, 'info');

    startWorker('reconciler', ['maintenance']);

    expect(info).toHaveBeenCalledWith(
      { worker: 'reconciler', consuming: ['maintenance'] },
      'connected',
    );
  });

  it('has an empty list when it consumes nothing, rather than no list', () => {
    const info = vi.spyOn(logger, 'info');

    startWorker('ingestion-worker');

    expect(info).toHaveBeenCalledWith({ worker: 'ingestion-worker', consuming: [] }, 'connected');
  });

  it('closes the queue and what the caller holds on SIGTERM', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const pool = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    startWorker('reconciler', ['maintenance']).closeOnSigterm(pool);
    process.emit('SIGTERM');
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0);
    });

    expect(pool).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('exits anyway when a close never settles, rather than waiting for SIGKILL', async () => {
    // Redis unreachable at `docker compose stop`: an unbounded await means Docker kills the
    // process with no line saying why.
    close.mockReturnValue(new Promise(() => undefined));
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const info = vi.spyOn(logger, 'info');
    vi.useFakeTimers();

    startWorker('event-handler').closeOnSigterm();
    process.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(10_000);
    vi.useRealTimers();

    expect(info).toHaveBeenCalledWith(
      { worker: 'event-handler', path: 'forced' },
      'shutdown complete',
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits non-zero when a close fails, so the restart is not silent', async () => {
    close.mockRejectedValue(new Error('connection lost'));
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    startWorker('reconciler').closeOnSigterm();
    process.emit('SIGTERM');
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(1);
    });
  });
});
