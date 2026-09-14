import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventRegistry } from '@src/events/event-registry.js';
import { eventRouting } from '@src/events/event-routing.js';
import { EventQueue } from '@src/shared/queue/event-queue.js';
import { SweepOrphanChunksCommand } from '@src/modules/reconciler/commands/sweep-orphan-chunks-command.js';

const redisUrl = process.env.QUEUE_TEST_REDIS_URL ?? 'redis://127.0.0.1:6399';
const QUEUE_DB = 1;
const PREFIX = `bulltest-${randomUUID().slice(0, 8)}`;
const logger = pino({ level: 'silent' });

const chunks = {
  orphaned: () => Promise.resolve([{ jobId: 7, chunkIndex: 2 }]),
  runningJobIds: () => Promise.resolve([]),
};
const imports = { completeJobIfDone: () => Promise.resolve(false) };

describe('SweepOrphanChunksCommand against a real queue', () => {
  let bus: ReturnType<typeof EventQueue.connect<typeof eventRegistry>>;
  let ingestion: Queue;

  beforeAll(() => {
    bus = EventQueue.connect(redisUrl, QUEUE_DB, eventRegistry, eventRouting, PREFIX);
    ingestion = new Queue('ingestion', {
      connection: { url: redisUrl, db: QUEUE_DB },
      prefix: PREFIX,
    });
  });

  afterAll(async () => {
    await ingestion.obliterate({ force: true });
    await ingestion.close();
    await bus.close();
  });

  it('can sweep one chunk twice, which a pinned job id would silently prevent', async () => {
    const sweep = new SweepOrphanChunksCommand(chunks, imports, bus, 90_000, logger);

    await sweep.execute();
    await sweep.execute();

    // Proved against the real library rather than a double that always accepts:
    // BullMQ keeps completed and failed keys, and an `add` whose custom id
    // already exists returns that job and queues nothing. A sweep that pinned
    // `chunk:7:2` would repair a chunk once and never again — on exactly the
    // import that needed a second attempt.
    expect(await ingestion.getWaitingCount()).toBe(2);
  });
});
