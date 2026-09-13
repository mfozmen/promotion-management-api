import type { QueueStats } from './dto/queue-stats.js';
import type { QueueName } from '../../../shared/queue/queue-name.js';

/** What an operator can be told about a queue without being able to change it. */
export class QueueStatsReporter {
  constructor(
    private readonly bus: {
      names(): QueueName[];
      inspect(name: QueueName): {
        getWaitingCount(): Promise<number>;
        getActiveCount(): Promise<number>;
        getDelayedCount(): Promise<number>;
        getFailedCount(): Promise<number>;
        // Exactly the call this makes: a wider `string[]` would not match BullMQ's own
        // `JobType[]`, and widening the domain to import that type would drag the library in.
        getJobs(
          types: ['waiting'],
          start: number,
          end: number,
          asc: boolean,
        ): Promise<{ timestamp: number }[]>;
      };
    },
    private readonly now: () => Date,
    /**
     * The queue's own operation bound. Redis reads carry none of their own: a non-blocking
     * BullMQ connection retries for minutes before rejecting, which would hang the one
     * endpoint an operator has at the moment it is needed.
     */
    private readonly timeoutMs: number,
  ) {}

  async report(): Promise<QueueStats[]> {
    return this.bounded(Promise.all(this.bus.names().map((name) => this.readOne(name))));
  }

  private async readOne(queue: QueueName): Promise<QueueStats> {
    const reader = this.bus.inspect(queue);
    // One `Promise.all` on one connection, so five reads cost about one round trip. They are
    // still five commands: the counts and the oldest job describe instants that can differ,
    // which is why the age's contract is about what was returned rather than what is waiting.
    const [waiting, active, delayed, failed, oldest] = await Promise.all([
      reader.getWaitingCount(),
      reader.getActiveCount(),
      reader.getDelayedCount(),
      reader.getFailedCount(),
      // One job, the oldest, rather than the list: at the 10 000-job threshold the alert is
      // about, the list is the outage (REVIEW.md 6.21).
      reader.getJobs(['waiting'], 0, 0, true),
    ]);

    return { queue, waiting, active, delayed, failed, oldestWaitingAgeSeconds: this.age(oldest) };
  }

  /**
   * `timestamp` is stamped by the process that published the job, so the disagreement this
   * absorbs is between publishers, not with Redis. Negative is the visible tip of a skew that
   * also understates every positive age.
   */
  private age(oldest: { timestamp: number }[]): number | null {
    const first = oldest[0];

    return first === undefined
      ? null
      : Math.max(0, Math.floor((this.now().getTime() - first.timestamp) / 1000));
  }

  private async bounded(work: Promise<QueueStats[]>): Promise<QueueStats[]> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`queue stats did not answer within ${this.timeoutMs} ms`)),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
