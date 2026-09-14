import { Gauge } from 'prom-client';
import { metricsRegistry } from './metrics-registry.js';

interface Depth {
  name: string;
  getWaitingCount(): Promise<number>;
  getFailedCount(): Promise<number>;
}

/**
 * Read at scrape time rather than tracked as the process publishes: a queue's depth is a fact
 * about Redis that four processes contribute to, so a counter kept in one of them would report
 * that process's share and read as the queue's. The queues come from the bus that holds them,
 * so this cannot drift from what exists.
 */
export function queueDepth(queues: readonly Depth[]): void {
  const gauge = (name: string, help: string, read: (queue: Depth) => Promise<number>): void => {
    // A second registration of the same name throws, and a test that builds two apps is the
    // caller that finds out; the first registration is as good as the second.
    if (metricsRegistry.getSingleMetric(name) !== undefined) return;
    new Gauge({
      name,
      help,
      labelNames: ['queue'],
      registers: [metricsRegistry],
      async collect() {
        for (const queue of queues) this.set({ queue: queue.name }, await read(queue));
      },
    });
  };

  gauge('queue_waiting', 'Jobs waiting per queue', (queue) => queue.getWaitingCount());
  // `removeOnFail: false` makes the failed set the dead-letter queue (ADR-0003), so this is its
  // depth rather than a failure rate.
  gauge('queue_failed', 'Jobs in the dead-letter set per queue', (queue) => queue.getFailedCount());
}
