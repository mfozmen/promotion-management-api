import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { eventRegistry } from '@src/events/event-registry.js';
import { eventRouting } from '@src/events/event-routing.js';
import { EventQueue } from '@src/shared/queue/event-queue.js';
import { SweepBoundariesCommand } from '@src/modules/reconciler/commands/sweep-boundaries-command.js';
import { PromotionScheduler } from '@src/modules/promotion/domain/promotion-scheduler.js';
import { logger } from '@src/shared/logger.js';
import { randomUUID } from 'node:crypto';

// These tests need a real Redis: docker run -d --rm -p 6399:6379 redis:7-alpine
const redisUrl = process.env.QUEUE_TEST_REDIS_URL ?? 'redis://127.0.0.1:6399';

const READ_MODEL_DB = 0;
const QUEUE_DB = 1;
// Every key this file writes sits under a prefix unique to the run, so a count
// over a queue means this run's jobs and not a sibling worktree's (REVIEW.md 7.6).
const PREFIX = `bulltest-${randomUUID().slice(0, 8)}`;
const QUEUE_NAMES = ['promotions', 'products', 'ingestion', 'maintenance'] as const;

/** Obliterating a queue is not something a running process should be able to do. */
async function clearOwnQueues(): Promise<void> {
  const options = { connection: { url: redisUrl, db: QUEUE_DB }, prefix: PREFIX };
  const queues = QUEUE_NAMES.map((name) => new Queue(name, options));
  try {
    await Promise.all(queues.map((queue) => queue.obliterate({ force: true })));
  } finally {
    await Promise.all(queues.map((queue) => queue.close()));
  }
}

// No default: a shared one hides what each caller actually expects to wait for.
async function waitFor(condition: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error('condition not met within timeout');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('EventQueue', () => {
  let bus: ReturnType<typeof EventQueue.connect<typeof eventRegistry>>;
  const workers: Pick<Worker, 'close'>[] = [];

  beforeAll(async () => {
    bus = EventQueue.connect(redisUrl, QUEUE_DB, eventRegistry, eventRouting, PREFIX);
    // A run killed mid-test leaves keys behind that fail the next one's counts.
    await clearOwnQueues();
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.close()));
    await clearOwnQueues();
  });

  afterAll(async () => {
    await bus.close();
  });

  it('round-trips a valid payload from producer to consumer', async () => {
    const received: unknown[] = [];
    workers.push(
      new Worker(
        'products',
        async (job: Job) => {
          received.push({ name: job.name, data: job.data });
        },
        { connection: { url: redisUrl, db: QUEUE_DB }, prefix: PREFIX },
      ),
    );

    await bus.publish('product.upserted', { productIds: [11, 22] });

    await waitFor(async () => received.length === 1, 4_000);
    expect(received[0]).toEqual({ name: 'product.upserted', data: { productIds: [11, 22] } });
  });

  it('gives a promotions consumer the sale first, with import announcements already queued', async () => {
    // Routing only, until a catalog consumer exists to be delayed by.
    for (let batch = 0; batch < 50; batch += 1) {
      await bus.publish('product.upserted', { productIds: [batch + 1] });
    }
    await bus.publish('promotion.changed', { promotionId: 4242 });

    const firstSeen = new Promise<unknown>((resolve) => {
      workers.push(
        new Worker('promotions', async (job: Job) => resolve(job.data), {
          connection: { url: redisUrl, db: QUEUE_DB },
          prefix: PREFIX,
        }),
      );
    });

    expect(await firstSeen).toEqual({ promotionId: 4242 });
  });

  it('applies the retry, backoff and dead-letter defaults to every job', async () => {
    const job = await bus.publish('reconciler.run', {});

    expect(job.opts.attempts).toBe(EventQueue.defaultJobOptions.attempts);
    expect(job.opts.backoff).toEqual({ type: 'exponential', delay: 1000 });
    expect(job.opts.removeOnComplete).toBe(1000);
    expect(job.opts.removeOnFail).toBe(false);
  });

  it('rejects a malformed payload at the boundary instead of enqueueing it', async () => {
    await expect(
      // @ts-expect-error the compile-time contract already rejects this payload
      bus.publish('promotion.changed', { promotionId: 'not-a-number' }),
    ).rejects.toThrow();

    expect(await bus.inspect('promotions').getWaitingCount()).toBe(0);
  });

  it('deduplicates a job by the id its caller supplies', async () => {
    const options = { jobId: 'promo:5:activate', delay: 86_400_000 };

    const first = await bus.publish('promotion.changed', { promotionId: 5 }, options);
    const second = await bus.publish('promotion.changed', { promotionId: 5 }, options);

    expect(first.id).toBe('promo:5:activate');
    expect(second.id).toBe(first.id);
    expect(await bus.inspect('promotions').getDelayedCount()).toBe(1);
  });

  it('stores the boundary jobs the scheduler schedules, under the ids it removes them by', async () => {
    // ADR-0007 promises this test catches a BullMQ that tightens the colon rule.
    // `promo:{id}:{boundary}` splits in three by luck rather than by method, and
    // every other test of the scheduler uses a double that validates no id at all.
    const scheduler = new PromotionScheduler(bus);
    const now = new Date();
    const at = new Date(now.getTime() + 86_400_000);

    const activate = await scheduler.schedule(11, 'activate', at, now);
    const expire = await scheduler.schedule(11, 'expire', at, now);

    expect([activate.id, expire.id]).toEqual(['promo:11:activate', 'promo:11:expire']);

    await scheduler.cancel(11);

    // Not the removal count: BullMQ's script returns `1` for a key that was not
    // there, so a count cannot tell a removal from a miss — which is what a
    // `cancel` building a different id from `schedule` would look like.
    expect(await bus.inspect('promotions').getJob('promo:11:activate')).toBeUndefined();
    expect(await bus.inspect('promotions').getJob('promo:11:expire')).toBeUndefined();
  });

  it('accepts the id the boundary sweep builds, which BullMQ parses rather than stores', async () => {
    // A custom id containing colons must split in exactly three, so an ISO timestamp
    // in the third part throws on every publish — a sweep that repairs nothing and
    // never advances its watermark. The rule is BullMQ's; the shape is ours.
    const since = new Date('2026-09-14T02:50:00.000Z');

    const job = await bus.publish(
      'promotion.changed',
      { promotionId: 5 },
      { jobId: SweepBoundariesCommand.jobId(5, since) },
    );

    expect(job.id).toBe(`sweep:5:${String(since.getTime())}`);
  });

  it.each([
    ['a delay of one millisecond', 1, 'delayed'],
    ['no delay at all', 0, 'waiting'],
  ] as const)('enqueues a job with %s', async (_case, delay, expected) => {
    const job = await bus.publish('promotion.changed', { promotionId: 8 }, { delay });

    expect(await bus.inspect('promotions').getDelayedCount()).toBe(expected === 'delayed' ? 1 : 0);
    expect(await bus.inspect('promotions').getWaitingCount()).toBe(expected === 'waiting' ? 1 : 0);
    expect(job.opts.attempts).toBe(3);
    expect(job.opts.backoff).toEqual({ type: 'exponential', delay: 1000 });
  });

  it('removes a delayed job by its id', async () => {
    await bus.publish(
      'promotion.changed',
      { promotionId: 7 },
      { jobId: 'promo:7:activate', delay: 86_400_000 },
    );
    expect(await bus.inspect('promotions').getDelayedCount()).toBe(1);

    expect(await bus.remove('promotion.changed', 'promo:7:activate')).toBe(1);

    expect(await bus.inspect('promotions').getDelayedCount()).toBe(0);
  });

  it('reports success when there was no such job to remove', async () => {
    expect(await bus.remove('promotion.changed', 'promo:999:expire')).toBe(1);
  });

  it('reports a removal code of zero when a worker already holds the job', async () => {
    let started: () => void = () => {};
    const hasStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release: () => void = () => {};
    const mayFinish = new Promise<void>((resolve) => {
      release = resolve;
    });
    workers.push(
      new Worker(
        'promotions',
        async () => {
          started();
          await mayFinish;
        },
        { connection: { url: redisUrl, db: QUEUE_DB }, prefix: PREFIX },
      ),
    );

    await bus.publish('promotion.changed', { promotionId: 9 }, { jobId: 'promo:9:activate' });
    await hasStarted;

    expect(await bus.remove('promotion.changed', 'promo:9:activate')).toBe(0);

    release();
  });

  it('retries a throwing job and leaves it in the failed set as the dead-letter queue', async () => {
    let attempts = 0;
    workers.push(
      new Worker(
        'ingestion',
        async () => {
          attempts += 1;
          throw new Error('poisoned job');
        },
        { connection: { url: redisUrl, db: QUEUE_DB }, prefix: PREFIX },
      ),
    );

    const job = await bus.publish('chunk.process', { jobId: 1, chunkIndex: 0 });

    // This job, not the queue's failed count: a sibling worktree's suite writes here too.
    await waitFor(
      async () => (await bus.inspect('ingestion').getJob(job.id!))?.finishedOn !== undefined,
      30_000,
    );
    expect(attempts).toBe(3);

    const failed = await bus.inspect('ingestion').getJob(job.id!);
    expect(failed?.attemptsMade).toBe(3);
    expect(failed?.failedReason).toBe('poisoned job');
    // The count, not just the job: `removeOnFail: false` is only a dead-letter queue if
    // something can see the set growing.
    expect(await bus.inspect('ingestion').getFailedCount()).toBe(1);
  }, 40_000);

  it('keeps every queue on the queue database and never writes to the read-model database', async () => {
    const readModel = new Redis(redisUrl, { db: READ_MODEL_DB });
    const queueDb = new Redis(redisUrl, { db: QUEUE_DB });
    try {
      await readModel.flushdb();

      await bus.publish('product.upserted', { productIds: [1] });
      await bus.publish('chunk.process', { jobId: 1, chunkIndex: 0 });

      expect(await readModel.dbsize()).toBe(0);
      expect(await queueDb.exists(`${PREFIX}:products:meta`)).toBe(1);
      expect(await queueDb.exists(`${PREFIX}:ingestion:meta`)).toBe(1);
    } finally {
      await Promise.all([readModel.quit(), queueDb.quit()]);
    }
  });
  it('stops accepting jobs once the queues are closed, so SIGTERM can exit', async () => {
    const closing = EventQueue.connect(redisUrl, QUEUE_DB, eventRegistry, eventRouting, PREFIX);
    const queued = await closing.publish('promotion.changed', { promotionId: 77 });

    await closing.close();

    // What landed before the close is durable; what had not is not, which is why
    // `src/server.ts` stops the HTTP server before it closes the queues.
    expect(await bus.inspect('promotions').getJob(queued.id as string)).toBeDefined();
    await expect(closing.publish('promotion.changed', { promotionId: 78 })).rejects.toThrow(
      /Connection is closed/,
    );
    expect(await bus.inspect('promotions').getWaitingCount()).toBe(1);
  });

  it('fails an enqueue against an unavailable queue instead of hanging the caller', async () => {
    const errors = vi.spyOn(logger, 'error').mockReturnValue(undefined);
    // Port 1 is never listening, and ioredis reconnects for ever, so this is the
    // "queue unavailable" case rather than a connection refused once.
    const unreachable = EventQueue.connect(
      'redis://127.0.0.1:1',
      QUEUE_DB,
      eventRegistry,
      eventRouting,
      PREFIX,
    );
    const startedAt = Date.now();
    try {
      await expect(unreachable.publish('promotion.changed', { promotionId: 1 })).rejects.toThrow(
        /publish\("promotion.changed"\) did not confirm within 2000 ms/,
      );
      expect(Date.now() - startedAt).toBeLessThan(EventQueue.OPERATION_TIMEOUT_MS * 3);
      expect(errors).toHaveBeenCalled();
      // What the line carries, not just that there is one (ADR-0010). pino's own
      // serializer builds the shape from `err`, so that is the key to assert on.
      for (const [fields] of errors.mock.calls) {
        expect(fields).toHaveProperty('err.name');
        expect(fields).toHaveProperty('err.message');
      }
    } finally {
      errors.mockRestore();
      await unreachable.close().catch(() => undefined);
    }
  });

  it('bounds a removal against an unavailable queue too', async () => {
    const errors = vi.spyOn(logger, 'error').mockReturnValue(undefined);
    const unreachable = EventQueue.connect(
      'redis://127.0.0.1:1',
      QUEUE_DB,
      eventRegistry,
      eventRouting,
      PREFIX,
    );
    try {
      await expect(unreachable.remove('promotion.changed', 'promo:5:activate')).rejects.toThrow(
        /remove\("promo:5:activate"\) did not confirm within 2000 ms/,
      );
    } finally {
      errors.mockRestore();
      await unreachable.close().catch(() => undefined);
    }
  });
});
