import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { products } from '@src/modules/product/db/schema/products.js';
import { ingestionChunks } from '@src/modules/ingestion/db/schema/ingestion-chunks.js';
import { ingestionJobs } from '@src/modules/ingestion/db/schema/ingestion-jobs.js';
import { ProcessChunkCommand } from '@src/modules/ingestion/commands/process-chunk-command.js';
import { ProductRepository } from '@src/modules/product/db/product-repository.js';
import { BasePriceCalculatorCache } from '@src/modules/pricing/domain/base-price-calculator-cache.js';
import type { PricingRuleRow } from '@src/modules/pricing/domain/dto/pricing-rule-row.js';
import { pricingRules } from '@src/modules/pricing/db/schema/pricing-rules.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

/** The processor logs a lost announcement; a test that is not about that ignores it. */
const silentLog = { error: () => undefined };

/** A seam inside the write transaction: the calculator runs per row, before the write. */
function calculatorsThatOnRow(hook: (n: number) => Promise<void>) {
  const real = calculators();
  let rows = 0;
  return {
    current: async () => {
      const calculator = await real.current();
      return {
        pricingRulesVersion: calculator.pricingRulesVersion,
        ruleIds: calculator.ruleIds,
        calculate: async (facts: Parameters<typeof calculator.calculate>[0]) => {
          await hook((rows += 1));
          return calculator.calculate(facts);
        },
      } as unknown as Awaited<ReturnType<typeof real.current>>;
    },
  };
}

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
      fileRef: basename(path),
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

    // The kill lands inside the second batch's write transaction — after the
    // first batch committed, before the second could. That is the window the
    // guarantee is about: a kill between batches proves nothing, because every
    // ordering survives that one.
    const dying = new ProcessChunkCommand({
      db: db(),
      products: new ProductRepository(db()),
      calculators: calculatorsThatOnRow((n) =>
        n === 3 ? Promise.reject(new Error('killed mid-batch')) : Promise.resolve(),
      ),
      batchSize: BATCH,
      reenqueue: () => Promise.resolve(),
      uploadDir: dir,
      log: silentLog,
      publish: (ids) => {
        announced.push(...ids);
        return Promise.resolve();
      },
    });

    await expect(dying.process({ jobId, chunkIndex: 0 })).rejects.toThrow('killed mid-batch');

    // Batch one committed, rows and checkpoint together. Batch two took neither:
    // the transaction that would have written its rows is the one that moved the
    // checkpoint, so the replay redoes exactly the work that was lost.
    expect(await db().select().from(products)).toHaveLength(BATCH);
    expect((await chunkRow(jobId))?.nextOffset).toBe(
      startOffset + Buffer.byteLength('SKU-0,name 0,Electronics,800.00,150\n') * BATCH,
    );
    expect(announced).toHaveLength(BATCH);

    // The dead worker still holds its lease, so nothing else touches the chunk.
    const blocked = new ProcessChunkCommand({
      db: db(),
      products: new ProductRepository(db()),
      calculators: calculators(),
      batchSize: BATCH,
      reenqueue: () => Promise.resolve(),
      uploadDir: dir,
      log: silentLog,
      publish: () => Promise.reject(new Error('should never be called')),
    });
    expect(await blocked.process({ jobId, chunkIndex: 0 })).toMatchObject({ claimed: false });

    await expireLease(jobId);

    const resumed = new ProcessChunkCommand({
      db: db(),
      products: new ProductRepository(db()),
      calculators: calculators(),
      batchSize: BATCH,
      reenqueue: () => Promise.resolve(),
      uploadDir: dir,
      log: silentLog,
      publish: (ids) => {
        announced.push(...ids);
        return Promise.resolve();
      },
    });
    const result = await resumed.process({ jobId, chunkIndex: 0 });

    // Four rows remained from the checkpoint, and the replayed batch cost nothing:
    // the upsert is keyed on the vendor's sku, so re-storing a row is a no-op.
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
