import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, asc, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChunkJobHandler } from '@src/modules/ingestion/jobs/chunk-job-handler.js';
import { ingestionChunks } from '@src/modules/ingestion/db/schema/ingestion-chunks.js';
import { ingestionJobs } from '@src/modules/ingestion/db/schema/ingestion-jobs.js';
import { ProductRepository } from '@src/modules/product/db/product-repository.js';
import { BasePriceCalculatorCache } from '@src/modules/pricing/domain/base-price-calculator-cache.js';
import type { PricingRuleRow } from '@src/modules/pricing/domain/dto/pricing-rule-row.js';
import { pricingRules } from '@src/modules/pricing/db/schema/pricing-rules.js';
import { products } from '@src/modules/product/db/schema/products.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

let dir: string;
let sequence = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pma-handler-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const header = 'sku,name,category,price,stock\n';
const silentLog = { error: () => undefined };

const calculators = () =>
  new BasePriceCalculatorCache({
    now: () => Date.now(),
    source: (): Promise<PricingRuleRow[]> =>
      db()
        .select()
        .from(pricingRules)
        .where(and(eq(pricingRules.type, 'ingestion'), eq(pricingRules.active, true)))
        .orderBy(desc(pricingRules.priority), asc(pricingRules.id)),
  });

async function jobWithChunk(rows: number): Promise<number> {
  sequence += 1;
  const body = Array.from(
    { length: rows },
    (_, i) => `SKU-${sequence}-${i},name,Electronics,800.00,150\n`,
  ).join('');
  const content = header + body;
  const path = join(dir, `vendor-${sequence}.csv`);
  writeFileSync(path, content);

  const [job] = await db()
    .insert(ingestionJobs)
    .values({
      vendor: `vendor-${sequence}`,
      fileRef: path,
      fileSha256: `sha-${sequence}`,
      fileSizeBytes: Buffer.byteLength(content),
      chunksTotal: 1,
    })
    .returning();
  await db()
    .insert(ingestionChunks)
    .values({
      jobId: job!.id,
      chunkIndex: 0,
      startOffset: Buffer.byteLength(header),
      endOffset: Buffer.byteLength(content),
      nextOffset: Buffer.byteLength(header),
    });
  return job!.id;
}

const handlerWith = (publish: (ids: readonly number[]) => Promise<void>, budgetMs = 60_000) =>
  new ChunkJobHandler({
    db: db(),
    products: new ProductRepository(db()),
    calculators: calculators(),
    publish,
    reenqueue: () => Promise.resolve(),
    log: silentLog,
    batchSize: 100,
    budgetMs,
    leaseMs: 90_000,
  });

describe('ChunkJobHandler', () => {
  it('runs the chunk a job names', async () => {
    const jobId = await jobWithChunk(3);

    const outcome = await handlerWith(() => Promise.resolve()).handle({ jobId, chunkIndex: 0 });

    expect(outcome).toMatchObject({ claimed: true, rowsProcessed: 3 });
    expect(await db().select().from(products).where(eq(products.ingestJobId, jobId))).toHaveLength(
      3,
    );
  });

  it('rejects a payload that is not a chunk reference, rather than acting on part of it', async () => {
    // The queue is at-least-once and its payloads outlive the code that wrote
    // them. A job from an older producer, or a hand-inserted one, must fail here
    // and not reach `claimChunk` with an undefined index.
    const handler = handlerWith(() => Promise.resolve());

    await expect(handler.handle({ jobId: 1 })).rejects.toThrow();
    await expect(handler.handle({ jobId: 1, chunkIndex: -1 })).rejects.toThrow();
    await expect(handler.handle({ jobId: 1, chunkIndex: 0, extra: true })).rejects.toThrow();
    await expect(handler.handle(null)).rejects.toThrow();
  });

  it('holds the job lock for longer than the budget it allows the invocation', () => {
    // BullMQ renews a lock while the handler runs; if the lock can expire before
    // the budget does, the queue hands the same chunk to a second worker while
    // the first is still inside a batch — the lease race, arriving from the queue
    // rather than from the database.
    expect(ChunkJobHandler.lockDurationFor(60_000)).toBeGreaterThan(60_000);
    expect(ChunkJobHandler.lockDurationFor(1_000)).toBeGreaterThan(1_000);
  });

  it('processes one chunk at a time, because a chunk is already the unit of parallelism', () => {
    expect(ChunkJobHandler.CONCURRENCY).toBe(1);
  });
});
