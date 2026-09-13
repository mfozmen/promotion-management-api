import type { EventBus } from './event-bus.js';

/**
 * Stops the HTTP server, then the queues, in that order: closing the queues does
 * not drain them, so the producers have to be gone first.
 */
export class GracefulShutdown {
  /** `server.close` waits for every open connection, so one long request can hold
   *  the process open until the orchestrator escalates to `SIGKILL`. Past this the
   *  queues are closed anyway and the exit is taken. */
  static readonly DEFAULT_TIMEOUT_MS = 10_000;

  constructor(
    private readonly bus: EventBus,
    private readonly timeoutMs: number = GracefulShutdown.DEFAULT_TIMEOUT_MS,
  ) {}

  /**
   * `Number('')` is 0 and `Number('abc')` is `NaN`, so an unset-but-present
   * `SHUTDOWN_TIMEOUT_MS=` in a compose or Kubernetes env block would otherwise
   * force every shutdown immediately. Digits only; `0` is a deliberate value.
   */
  static parseTimeout(raw: string | undefined): number {
    return raw !== undefined && /^\d+$/.test(raw.trim())
      ? Number(raw.trim())
      : GracefulShutdown.DEFAULT_TIMEOUT_MS;
  }

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
