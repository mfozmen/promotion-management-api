import { Gauge } from 'prom-client';
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
 */
export function queueDepth(queues: Depths, names: readonly QueueName[]): Gauge[] {
  const waiting = new Gauge({
    name: 'queue_waiting_jobs',
    help: 'Jobs waiting in a queue',
    labelNames: ['queue'],
    registers: [metricsRegistry],
    collect: async function () {
      for (const name of names)
        this.set({ queue: name }, await queues.inspect(name).getWaitingCount());
    },
  });

  const failed = new Gauge({
    name: 'queue_failed_jobs',
    help: 'Jobs in a queue\u2019s failed set, which is this system\u2019s dead-letter queue',
    labelNames: ['queue'],
    registers: [metricsRegistry],
    collect: async function () {
      for (const name of names)
        this.set({ queue: name }, await queues.inspect(name).getFailedCount());
    },
  });

  // Returned rather than discarded: a `new` whose result goes nowhere reads as a
  // mistake, and the registry holding them is not visible at this line.
  return [waiting, failed];
}
