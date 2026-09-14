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

/**
 * Queue depth as a series rather than a number on a dashboard. Bull Board already
 * shows both counts, and that is enough for a person looking; an alert rule cannot
 * look, so it needs the same facts over time (ADR-0011).
 *
 * Read at scrape time: a gauge set on a timer would report the last moment the
 * timer fired, which is the interval Prometheus is already choosing.
 *
 * Each read is bounded, because these bypass `EventQueue.bounded()` — a Redis that
 * accepts and never answers would otherwise hold the scrape open until Prometheus
 * times it out, and the metrics endpoint is what an operator reaches for when Redis
 * is the thing that is wrong.
 */
const READ_TIMEOUT_MS = 2_000;

/** A depth nobody could read is reported as -1 rather than as zero: zero is a
 *  queue that is empty, and an alert on either must be able to tell them apart.
 *  The reason is logged, because -1 says a read failed and never says why. */
async function within(queue: QueueName, read: Promise<number>, logger: Logger): Promise<number> {
  // Definite assignment: the executor runs before the race is handed back.
  let timer!: NodeJS.Timeout;
  const capped = new Promise<number>((resolve) => {
    timer = setTimeout(() => {
      logger.warn({ queue, timeoutMs: READ_TIMEOUT_MS }, 'queue depth read timed out');
      resolve(-1);
    }, READ_TIMEOUT_MS);
  });
  const answered = read.catch((err: unknown) => {
    logger.warn({ queue, err }, 'queue depth read failed');
    return -1;
  });

  return Promise.race([answered, capped]).finally(() => clearTimeout(timer));
}

/**
 * The queues are read concurrently, not one after another: four serial reads of a
 * Redis that accepts and never answers would spend 4 × the bound, and Prometheus
 * clamps a scrape's timeout down to `scrape_interval`. Serially, one hung Redis
 * cost the whole endpoint — heap, event-loop lag and the drift counter with it —
 * and paged `TargetDown` for a process that was alive.
 */
export function queueDepth(queues: Depths, names: readonly QueueName[], logger: Logger): Gauge[] {
  const each = async (gauge: Gauge, read: (name: QueueName) => Promise<number>): Promise<void[]> =>
    Promise.all(
      names.map(async (name) => {
        gauge.set({ queue: name }, await within(name, read(name), logger));
      }),
    );

  const waiting = new Gauge({
    name: 'queue_waiting_jobs',
    help: 'Jobs waiting in a queue',
    labelNames: ['queue'],
    registers: [metricsRegistry],
    collect: async function () {
      await each(this, (name) => queues.inspect(name).getWaitingCount());
    },
  });

  const failed = new Gauge({
    name: 'queue_failed_jobs',
    help: 'Jobs in a queue’s failed set, which is this system’s dead-letter queue',
    labelNames: ['queue'],
    registers: [metricsRegistry],
    collect: async function () {
      await each(this, (name) => queues.inspect(name).getFailedCount());
    },
  });

  // Returned rather than discarded: a `new` whose result goes nowhere is a Sonar
  // finding (S1848), and the registry holding them is not visible at this line.
  return [waiting, failed];
}
