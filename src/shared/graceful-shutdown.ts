import type { EventQueue } from './queue/event-queue.js';

type Close = () => Promise<unknown>;

interface Server {
  close: (onClosed: () => void) => void;
}

/**
 * The shutdown contract for every process in this image. The order is the mechanism —
 * closing the queues does not drain them, so the producers go first — and the budget is one
 * deadline over the whole sequence: a bound on the server alone left the queue and the pool
 * free to hang past Docker's grace period, which spends the exit code on a `SIGKILL` and
 * writes no line saying why.
 */
export class GracefulShutdown {
  constructor(
    private readonly queue: Pick<EventQueue<never>, 'close'>,
    private readonly timeoutMs: number,
  ) {}

  /** An HTTP process: the listener stops taking requests first. */
  async run(server: Server, ...also: Close[]): Promise<'drained' | 'forced'> {
    return this.within([
      () => new Promise<void>((resolve) => server.close(() => resolve())),
      ...also,
    ]);
  }

  /** A worker: whatever it consumes with stops first, and an idle one passes nothing. */
  async close(...also: Close[]): Promise<'drained' | 'forced'> {
    return this.within(also);
  }

  /** The queue closes last, so nothing can still be mid-publish when the handle goes. */
  private async within(steps: Close[]): Promise<'drained' | 'forced'> {
    return this.race([...steps, () => this.queue.close()]);
  }

  private async race(steps: Close[]): Promise<'drained' | 'forced'> {
    let timer: NodeJS.Timeout | undefined;
    const sequence = (async () => {
      for (const step of steps) await step();

      return 'drained' as const;
    })();
    try {
      return await Promise.race([
        sequence,
        new Promise<'forced'>((resolve) => {
          timer = setTimeout(() => resolve('forced'), this.timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      // The race has already delivered a failure that arrived in time; this is only so that
      // one landing after the deadline is not an unhandled rejection.
      sequence.catch(() => undefined);
    }
  }
}
