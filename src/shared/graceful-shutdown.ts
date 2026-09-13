import type { EventBus } from './event-bus.js';

/**
 * Stops the HTTP server, then the queues, in that order: closing the queues does
 * not drain them, so the producers have to be gone first.
 */
export class GracefulShutdown {
  constructor(
    private readonly bus: EventBus,
    private readonly timeoutMs: number,
  ) {}

  async run(server: { close: (onClosed: () => void) => void }): Promise<'drained' | 'forced'> {
    let timer: NodeJS.Timeout | undefined;
    const drained = await Promise.race([
      new Promise<boolean>((resolve) => server.close(() => resolve(true))),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), this.timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    await this.bus.close();
    return drained ? 'drained' : 'forced';
  }
}
