import { Gauge } from 'prom-client';
import type { Logger } from 'pino';
import { metricsRegistry } from './metrics-registry.js';
import type { QueueName } from '../queue/queue-name.js';

interface Depths {
  inspect(name: QueueName): {
    getWaitingCount(): Promise<number>;
    getFailedCount(): Promise<number>;
  };
}

/** These bypass `EventQueue.bounded()`, so they carry their own bound (ADR-0012). */
const READ_TIMEOUT_MS = 2_000;

/** A depth nobody could read is -1 rather than 0: 0 is a queue that is empty, and
 *  an alert on either must be able to tell them apart. */
async function within(
  read: Promise<number>,
  fail: (why: string, err?: unknown) => void,
): Promise<number> {
  // Definite assignment: the executor runs before the race is handed back.
  let timer!: NodeJS.Timeout;
  const capped = new Promise<number>((resolve) => {
    timer = setTimeout(() => {
      fail('queue depth read timed out');
      resolve(-1);
    }, READ_TIMEOUT_MS);
  });
  const answered = read.catch((err: unknown) => {
    fail('queue depth read failed', err);
    return -1;
  });

  return Promise.race([answered, capped]).finally(() => clearTimeout(timer));
}

/** The queues are read concurrently: serially, four hung queues spend four times
 *  the bound and Prometheus allows a scrape less than that (ADR-0012). */
export function queueDepth(queues: Depths, names: readonly QueueName[], logger: Logger): Gauge[] {
  // Eight reads every five seconds is eight identical lines every five seconds for
  // as long as Redis is away, and the first one - the one that says why - is then
  // the one an operator cannot find. Each read speaks when its answer changes.
  const quiet = new Set<string>();
  const onFailure =
    (kind: string, queue: QueueName) =>
    (why: string, err?: unknown): void => {
      const key = `${kind}:${queue}`;
      if (quiet.has(key)) return;
      quiet.add(key);
      logger.warn({ queue, kind, err }, why);
    };
  const onAnswer = (kind: string, queue: QueueName, depth: number): number => {
    if (depth !== -1 && quiet.delete(`${kind}:${queue}`)) {
      logger.info({ queue, kind }, 'queue depth readable again');
    }
    return depth;
  };

  const each = async (
    gauge: Gauge,
    kind: string,
    read: (name: QueueName) => Promise<number>,
  ): Promise<void[]> =>
    Promise.all(
      names.map(async (name) => {
        const depth = await within(read(name), onFailure(kind, name));
        gauge.set({ queue: name }, onAnswer(kind, name, depth));
      }),
    );

  const waiting = new Gauge({
    name: 'queue_waiting_jobs',
    help: 'Jobs waiting in a queue',
    labelNames: ['queue'],
    registers: [metricsRegistry],
    collect: async function () {
      await each(this, 'waiting', (name) => queues.inspect(name).getWaitingCount());
    },
  });

  const failed = new Gauge({
    name: 'queue_failed_jobs',
    help: 'Jobs in a queue\u2019s failed set, which is this system\u2019s dead-letter queue',
    labelNames: ['queue'],
    registers: [metricsRegistry],
    collect: async function () {
      await each(this, 'failed', (name) => queues.inspect(name).getFailedCount());
    },
  });

  // The registry holding these is not visible at this line, so a `new` whose
  // result went nowhere would read as a mistake.
  return [waiting, failed];
}
