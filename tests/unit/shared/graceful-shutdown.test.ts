import { describe, expect, it, vi } from 'vitest';
import { GracefulShutdown } from '@src/shared/graceful-shutdown.js';

const closes = () => vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const never = () => new Promise<void>(() => undefined);

describe('GracefulShutdown', () => {
  it('closes the queue with no server to stop first, which is a worker', async () => {
    const queue = { close: closes() };

    await expect(new GracefulShutdown(queue, 1_000).close()).resolves.toBe('drained');
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it('gives up on a queue close that never settles instead of waiting for SIGKILL', async () => {
    // Redis is usually what has already gone when a stop is issued, and `close()` against it
    // never settles. The budget has to cover the queue, not only the server.
    vi.useFakeTimers();
    const shutdown = new GracefulShutdown({ close: never }, 1_000);

    const outcome = shutdown.close();
    await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();

    await expect(outcome).resolves.toBe('forced');
  });

  it('spends one budget over the whole sequence, not one per step', async () => {
    // Two 600 ms steps under a 1 s budget is 1.2 s of work: a per-step bound would call
    // that drained and hand back a process Docker then kills.
    vi.useFakeTimers();
    const slow = () => new Promise<void>((resolve) => setTimeout(resolve, 600));
    const shutdown = new GracefulShutdown({ close: slow }, 1_000);

    const outcome = shutdown.close(slow);
    await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();

    await expect(outcome).resolves.toBe('forced');
  });

  it('closes the queue last, after everything the caller passed', async () => {
    const order: string[] = [];
    const queue = { close: () => Promise.resolve(void order.push('queue')) };

    await new GracefulShutdown(queue, 1_000).close(
      () => Promise.resolve(void order.push('pool')),
      () => Promise.resolve(void order.push('cache')),
    );

    // Nothing can be mid-publish by the time the producer handle goes.
    expect(order).toEqual(['pool', 'cache', 'queue']);
  });

  it('stops the server before the queue, since closing a queue does not drain it', async () => {
    const order: string[] = [];
    const queue = { close: () => Promise.resolve(void order.push('queue')) };
    const server = {
      close: (onClosed: () => void) => {
        order.push('server');
        onClosed();
      },
    };

    await expect(new GracefulShutdown(queue, 1_000).run(server)).resolves.toBe('drained');
    expect(order).toEqual(['server', 'queue']);
  });

  it('reports the failure rather than an outcome when a step throws', async () => {
    const queue = { close: () => Promise.reject(new Error('connection lost')) };

    await expect(new GracefulShutdown(queue, 1_000).close()).rejects.toThrow('connection lost');
  });
});
