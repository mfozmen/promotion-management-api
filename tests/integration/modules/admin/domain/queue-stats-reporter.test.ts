import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventRegistry } from '@src/events/event-registry.js';
import { eventRouting } from '@src/events/event-routing.js';
import { QueueStatsReporter } from '@src/modules/admin/domain/queue-stats-reporter.js';
import { EventQueue } from '@src/shared/queue/event-queue.js';

const redisUrl = process.env.QUEUE_TEST_REDIS_URL ?? 'redis://127.0.0.1:6399';
const QUEUE_DB = 1;
const PREFIX = `statstest-${randomUUID().slice(0, 8)}`;
const QUEUE_NAMES = ['promotions', 'catalog', 'ingestion', 'maintenance'] as const;

async function obliterate(): Promise<void> {
  const options = { connection: { url: redisUrl, db: QUEUE_DB }, prefix: PREFIX };
  const queues = QUEUE_NAMES.map((name) => new Queue(name, options));
  try {
    await Promise.all(queues.map((queue) => queue.obliterate({ force: true })));
  } finally {
    await Promise.all(queues.map((queue) => queue.close()));
  }
}

describe('QueueStatsReporter against a real queue', () => {
  let bus: ReturnType<typeof EventQueue.connect<typeof eventRegistry>>;

  beforeAll(async () => {
    bus = EventQueue.connect(redisUrl, QUEUE_DB, eventRegistry, eventRouting, PREFIX);
    await obliterate();
  });

  afterAll(async () => {
    await obliterate();
    await bus.close();
  });

  // The unit tests fake the reader; this is the one that proves BullMQ answers the way they
  // assume — that `getJobs(['waiting'], 0, 0, true)` yields the oldest job, carrying a
  // millisecond `timestamp`, rather than the newest or the whole list.
  it('reads the counts and the oldest waiting age out of Redis', async () => {
    await bus.publish('promotion.changed', { promotionId: 1 });
    await bus.publish('promotion.changed', { promotionId: 2 });
    await bus.publish('promotion.changed', { promotionId: 3 }, { delay: 86_400_000 });

    const oneMinuteOn = new Date(Date.now() + 60_000);
    const stats = await new QueueStatsReporter(
      bus,
      () => oneMinuteOn,
      EventQueue.OPERATION_TIMEOUT_MS,
    ).report();
    const promotions = stats.find((entry) => entry.queue === 'promotions');

    expect(stats.map((entry) => entry.queue)).toEqual([...QUEUE_NAMES]);
    expect(promotions).toMatchObject({ waiting: 2, active: 0, delayed: 1, failed: 0 });
    // Aged against a clock a minute ahead, so the assertion is a number rather than "not null":
    // a reader that returned the newest job would be a second or two out, not sixty.
    expect(promotions?.oldestWaitingAgeSeconds).toBe(60);
    expect(stats.find((entry) => entry.queue === 'catalog')?.oldestWaitingAgeSeconds).toBeNull();
  });
});
