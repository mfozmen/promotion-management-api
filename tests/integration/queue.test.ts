import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import {
  QUEUE_DB,
  QUEUE_OPERATION_TIMEOUT_MS,
  closeQueues,
  createQueues,
  defaultJobOptions,
  enqueue,
  promotionBoundaryJobId,
  removePromotionBoundaries,
  schedulePromotionBoundary,
  withinTransaction,
  type Queues,
} from '../../src/shared/queue.js';

// These tests need a real Redis: docker run -d --rm -p 6399:6379 redis:7-alpine
const redisUrl = process.env.QUEUE_TEST_REDIS_URL ?? 'redis://127.0.0.1:6399';

const READ_MODEL_DB = 0;

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error('condition not met within timeout');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('queue contracts', () => {
  let queues: Queues;
  const workers: Pick<Worker, 'close'>[] = [];

  beforeAll(() => {
    queues = createQueues(redisUrl);
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.close()));
    await Promise.all([
      queues.events.obliterate({ force: true }),
      queues.ingestion.obliterate({ force: true }),
    ]);
  });

  afterAll(async () => {
    await closeQueues(queues);
  });

  it('round-trips a valid payload from producer to consumer', async () => {
    const received: unknown[] = [];
    workers.push(
      new Worker(
        'events',
        async (job: Job) => {
          received.push({ name: job.name, data: job.data });
        },
        { connection: { url: redisUrl, db: QUEUE_DB } },
      ),
    );

    await enqueue(queues, 'product.upserted', { productIds: [11, 22] });

    await waitFor(async () => received.length === 1);
    expect(received[0]).toEqual({ name: 'product.upserted', data: { productIds: [11, 22] } });
  });

  it('applies the retry, backoff and dead-letter defaults to every job', async () => {
    const job = await enqueue(queues, 'reconcile.run', {});

    expect(job.opts.attempts).toBe(defaultJobOptions.attempts);
    expect(job.opts.backoff).toEqual({ type: 'exponential', delay: 1000 });
    expect(job.opts.removeOnComplete).toBe(1000);
    expect(job.opts.removeOnFail).toBe(false);
  });

  it('rejects a malformed payload at the boundary instead of enqueueing it', async () => {
    await expect(
      // @ts-expect-error the compile-time contract already rejects this payload
      enqueue(queues, 'promotion.changed', { promotionId: 'not-a-number' }),
    ).rejects.toThrow();

    expect(await queues.events.getWaitingCount()).toBe(0);
  });

  it('deduplicates a promotion boundary job by its deterministic id', async () => {
    const startsAt = new Date('2026-09-13T00:00:00.000Z');
    const now = new Date('2026-09-12T00:00:00.000Z');

    const first = await schedulePromotionBoundary(queues, 5, 'activate', startsAt, now);
    const second = await schedulePromotionBoundary(queues, 5, 'activate', startsAt, now);

    expect(first.id).toBe(promotionBoundaryJobId(5, 'activate'));
    expect(second.id).toBe(first.id);
    expect(await queues.events.getDelayedCount()).toBe(1);
  });

  it('enqueues a boundary immediately when its instant has already passed', async () => {
    const startsAt = new Date('2026-09-11T00:00:00.000Z');
    const now = new Date('2026-09-12T00:00:00.000Z');

    await schedulePromotionBoundary(queues, 6, 'activate', startsAt, now);

    expect(await queues.events.getDelayedCount()).toBe(0);
    expect(await queues.events.getWaitingCount()).toBe(1);
  });

  it.each([
    ['one millisecond before the boundary', 1, 'delayed'],
    ['exactly at the boundary', 0, 'waiting'],
    ['one millisecond after the boundary', -1, 'waiting'],
  ] as const)('schedules a boundary %s', async (_case, offsetMs, expected) => {
    const at = new Date('2026-09-12T12:00:00.000Z');
    const now = new Date(at.getTime() - offsetMs);

    const job = await schedulePromotionBoundary(queues, 8, 'expire', at, now);

    expect(await queues.events.getDelayedCount()).toBe(expected === 'delayed' ? 1 : 0);
    expect(await queues.events.getWaitingCount()).toBe(expected === 'waiting' ? 1 : 0);
    expect(job.opts.attempts).toBe(3);
    expect(job.opts.backoff).toEqual({ type: 'exponential', delay: 1000 });
  });

  it('removes both boundary jobs by id when a promotion is cancelled', async () => {
    const now = new Date('2026-09-12T00:00:00.000Z');
    await schedulePromotionBoundary(
      queues,
      7,
      'activate',
      new Date('2026-09-13T00:00:00.000Z'),
      now,
    );
    await schedulePromotionBoundary(queues, 7, 'expire', new Date('2026-09-14T00:00:00.000Z'), now);
    expect(await queues.events.getDelayedCount()).toBe(2);

    expect(await removePromotionBoundaries(queues, 7)).toEqual({ activate: 1, expire: 1 });

    expect(await queues.events.getDelayedCount()).toBe(0);
  });

  it('reports success when a cancelled promotion had no boundary job at all', async () => {
    expect(await removePromotionBoundaries(queues, 999)).toEqual({ activate: 1, expire: 1 });
  });

  it('reports a removal code of zero when a boundary job is already being processed', async () => {
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
        'events',
        async () => {
          started();
          await mayFinish;
        },
        { connection: { url: redisUrl, db: QUEUE_DB } },
      ),
    );

    const now = new Date('2026-09-12T00:00:00.000Z');
    await schedulePromotionBoundary(queues, 9, 'activate', now, now);
    await hasStarted;

    expect(await removePromotionBoundaries(queues, 9)).toEqual({ activate: 0, expire: 1 });

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
        { connection: { url: redisUrl, db: QUEUE_DB } },
      ),
    );

    const job = await enqueue(queues, 'ingestion.chunk', { jobId: 1, chunkIndex: 0 });

    await waitFor(async () => (await queues.ingestion.getFailedCount()) === 1, 30_000);
    expect(attempts).toBe(3);

    const failed = await queues.ingestion.getJob(job.id!);
    expect(failed?.attemptsMade).toBe(3);
    expect(failed?.failedReason).toBe('poisoned job');
  }, 40_000);

  it('refuses to enqueue inside a PostgreSQL transaction and allows it after the commit', async () => {
    await expect(
      withinTransaction(async () => enqueue(queues, 'promotion.changed', { promotionId: 1 })),
    ).rejects.toThrow(/after the PostgreSQL commit/);
    expect(await queues.events.getWaitingCount()).toBe(0);

    await withinTransaction(async () => undefined);
    await enqueue(queues, 'promotion.changed', { promotionId: 1 });

    expect(await queues.events.getWaitingCount()).toBe(1);
  });

  it('refuses to remove boundary jobs inside a PostgreSQL transaction', async () => {
    const now = new Date('2026-09-12T00:00:00.000Z');
    await schedulePromotionBoundary(
      queues,
      10,
      'expire',
      new Date('2026-09-13T00:00:00.000Z'),
      now,
    );

    await expect(
      withinTransaction(async () => removePromotionBoundaries(queues, 10)),
    ).rejects.toThrow(/after the PostgreSQL commit/);

    expect(await queues.events.getDelayedCount()).toBe(1);
  });

  it('keeps both queues on the queue database and never writes to the read-model database', async () => {
    const readModel = new Redis(redisUrl, { db: READ_MODEL_DB });
    const queueDb = new Redis(redisUrl, { db: QUEUE_DB });
    try {
      await readModel.flushdb();

      await enqueue(queues, 'product.upserted', { productIds: [1] });
      await enqueue(queues, 'ingestion.chunk', { jobId: 1, chunkIndex: 0 });

      expect(await readModel.dbsize()).toBe(0);
      expect(await queueDb.exists('bull:events:meta')).toBe(1);
      expect(await queueDb.exists('bull:ingestion:meta')).toBe(1);
    } finally {
      await Promise.all([readModel.quit(), queueDb.quit()]);
    }
  });
  it('stops accepting jobs once the queues are closed, so SIGTERM can exit', async () => {
    const closing = createQueues(redisUrl);
    const queued = await enqueue(closing, 'promotion.changed', { promotionId: 77 });

    await closeQueues(closing);

    // What landed before the close is durable; what had not is not, which is why
    // `src/server.ts` stops the HTTP server before it closes the queues.
    expect(await queues.events.getJob(queued.id as string)).toBeDefined();
    await expect(enqueue(closing, 'promotion.changed', { promotionId: 78 })).rejects.toThrow(
      /Connection is closed/,
    );
    expect(await queues.events.getWaitingCount()).toBe(1);
  });

  it('fails an enqueue against an unavailable queue instead of hanging the caller', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Port 1 is never listening, and ioredis reconnects for ever, so this is the
    // "queue unavailable" case rather than a connection refused once.
    const unreachable = createQueues('redis://127.0.0.1:1');
    const startedAt = Date.now();
    try {
      await expect(enqueue(unreachable, 'promotion.changed', { promotionId: 1 })).rejects.toThrow(
        /enqueue\("promotion.changed"\) did not confirm within 2000 ms/,
      );
      expect(Date.now() - startedAt).toBeLessThan(QUEUE_OPERATION_TIMEOUT_MS * 3);
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
      await closeQueues(unreachable).catch(() => undefined);
    }
  });

  it('bounds boundary removal against an unavailable queue too', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unreachable = createQueues('redis://127.0.0.1:1');
    try {
      await expect(removePromotionBoundaries(unreachable, 5)).rejects.toThrow(
        /removePromotionBoundaries\(5\) did not confirm within 2000 ms/,
      );
    } finally {
      errors.mockRestore();
      await closeQueues(unreachable).catch(() => undefined);
    }
  });
});
