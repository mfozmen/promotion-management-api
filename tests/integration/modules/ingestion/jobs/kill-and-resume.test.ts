import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { products } from '@src/modules/product/db/schema/products.js';
import { ingestionChunks } from '@src/modules/ingestion/db/schema/ingestion-chunks.js';
import { ingestionJobs } from '@src/modules/ingestion/db/schema/ingestion-jobs.js';
import { ChunkProcessor } from '@src/modules/ingestion/jobs/chunk-processor.js';
import { BasePriceCalculatorCache } from '@src/modules/pricing/domain/base-price-calculator-cache.js';
import type { PricingRuleRow } from '@src/modules/pricing/domain/dto/pricing-rule-row.js';
import { pricingRules } from '@src/modules/pricing/db/schema/pricing-rules.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pma-kill-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const header = 'sku,name,category,price,stock\n';
const ROWS = 6;
const BATCH = 2;

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

async function sixRowFile(): Promise<{ jobId: number; startOffset: number; endOffset: number }> {
  const body = Array.from(
    { length: ROWS },
    (_, i) => `SKU-${i},name ${i},Electronics,800.00,150\n`,
  ).join('');
  const content = header + body;
  const path = join(dir, 'vendor.csv');
  writeFileSync(path, content);

  const startOffset = Buffer.byteLength(header);
  const endOffset = Buffer.byteLength(content);
  const [job] = await db()
    .insert(ingestionJobs)
    .values({
      vendor: 'vendor',
      fileRef: path,
      fileSha256: 'sha',
      fileSizeBytes: endOffset,
      chunksTotal: 1,
    })
    .returning();
  await db()
    .insert(ingestionChunks)
    .values({ jobId: job!.id, chunkIndex: 0, startOffset, endOffset, nextOffset: startOffset });
  return { jobId: job!.id, startOffset, endOffset };
}

const chunkRow = async (jobId: number) => {
  const [found] = await db()
    .select()
    .from(ingestionChunks)
    .where(and(eq(ingestionChunks.jobId, jobId), eq(ingestionChunks.chunkIndex, 0)));
  return found;
};

/** What a crash leaves behind: the lease outlives the process that took it. */
const expireLease = (jobId: number) =>
  db()
    .update(ingestionChunks)
    .set({ leaseUntil: sql`now() - interval '1 second'` })
    .where(and(eq(ingestionChunks.jobId, jobId), eq(ingestionChunks.chunkIndex, 0)));

describe('a worker killed mid-chunk', () => {
  it('loses no row and duplicates none, and the lease is what protects it meanwhile', async () => {
    const { jobId, startOffset, endOffset } = await sixRowFile();
    const announced: number[] = [];

    // The kill lands between the store and the announce of the second batch —
    // the window the ordering argument is about. A kill between batches would
    // prove nothing: both orders survive that one.
    let batches = 0;
    const dying = new ChunkProcessor({
      db: db(),
      calculators: calculators(),
      batchSize: BATCH,
      reenqueue: () => Promise.resolve(),
      publish: (ids) => {
        batches += 1;
        if (batches === 2) return Promise.reject(new Error('killed mid-batch'));
        announced.push(...ids);
        return Promise.resolve();
      },
    });

    await expect(dying.process({ jobId, chunkIndex: 0 })).rejects.toThrow('killed mid-batch');

    // Batch one committed. Batch two stored its rows and never announced them, so
    // it never checkpointed either — which is what makes the replay correct.
    expect(await db().select().from(products)).toHaveLength(4);
    expect((await chunkRow(jobId))?.nextOffset).toBe(
      startOffset + Buffer.byteLength('SKU-0,name 0,Electronics,800.00,150\n') * BATCH,
    );
    expect(announced).toHaveLength(BATCH);

    // The dead worker still holds its lease, so nothing else touches the chunk.
    const blocked = new ChunkProcessor({
      db: db(),
      calculators: calculators(),
      batchSize: BATCH,
      reenqueue: () => Promise.resolve(),
      publish: () => Promise.reject(new Error('should never be called')),
    });
    expect(await blocked.process({ jobId, chunkIndex: 0 })).toMatchObject({ claimed: false });

    await expireLease(jobId);

    const resumed = new ChunkProcessor({
      db: db(),
      calculators: calculators(),
      batchSize: BATCH,
      reenqueue: () => Promise.resolve(),
      publish: (ids) => {
        announced.push(...ids);
        return Promise.resolve();
      },
    });
    const result = await resumed.process({ jobId, chunkIndex: 0 });

    // Four rows remained from the checkpoint, and the replayed batch cost nothing:
    // the upsert is keyed on the vendor's sku, so re-storing two rows is a no-op.
    expect(result).toMatchObject({ claimed: true, rowsProcessed: 4 });
    const stored = await db().select().from(products);
    expect(stored).toHaveLength(ROWS);
    expect(new Set(stored.map((p) => p.sku)).size).toBe(ROWS);

    // Every stored product was announced at least once. This is the assertion the
    // ordering exists for: at-least-once is recoverable, at-most-once is not.
    expect(new Set(announced)).toEqual(new Set(stored.map((p) => p.id)));

    const chunk = await chunkRow(jobId);
    expect(chunk?.nextOffset).toBe(endOffset);
    expect(chunk?.status).toBe('done');
    expect(chunk?.attempts).toBe(2);
  });
});
