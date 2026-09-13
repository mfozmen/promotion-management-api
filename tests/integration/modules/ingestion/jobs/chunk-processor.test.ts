import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, asc, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { products } from '@src/modules/catalog/db/schema/products.js';
import { claimChunk } from '@src/modules/ingestion/db/claim-chunk.js';
import { ingestionChunks } from '@src/modules/ingestion/db/schema/ingestion-chunks.js';
import { ingestionJobs } from '@src/modules/ingestion/db/schema/ingestion-jobs.js';
import { ChunkProcessor } from '@src/modules/ingestion/jobs/chunk-processor.js';
import { BasePriceCalculator } from '@src/modules/pricing/domain/base-price-calculator.js';
import { BasePriceCalculatorCache } from '@src/modules/pricing/domain/base-price-calculator-cache.js';
import type { PricingRuleRow } from '@src/modules/pricing/domain/dto/pricing-rule-row.js';
import { pricingRules } from '@src/modules/pricing/db/schema/pricing-rules.js';
import { useTestDatabase } from '../../../db.js';

const db = useTestDatabase();

let dir: string;
let sequence = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pma-processor-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const header = 'sku,name,category,price,stock\n';

/** A row the seeded ingestion rules price without rejecting it. */
const row = (n: number) => `SKU-${n}-${sequence},name ${n},Electronics,800.00,150\n`;

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

/** Writes a file, stores a job pointing at it and one chunk covering its rows. */
async function jobWithChunk(
  body: string,
  overrides: Partial<typeof ingestionChunks.$inferInsert> = {},
): Promise<{ jobId: number; startOffset: number; endOffset: number }> {
  sequence += 1;
  const content = header + body;
  const path = join(dir, `vendor-${sequence}.csv`);
  writeFileSync(path, content);

  const startOffset = Buffer.byteLength(header);
  const endOffset = Buffer.byteLength(content);
  const [job] = await db()
    .insert(ingestionJobs)
    .values({
      vendor: `vendor-${sequence}`,
      fileRef: path,
      fileSha256: `sha-${sequence}`,
      fileSizeBytes: endOffset,
      chunksTotal: 1,
    })
    .returning();
  await db()
    .insert(ingestionChunks)
    .values({
      jobId: job!.id,
      chunkIndex: 0,
      startOffset,
      endOffset,
      nextOffset: startOffset,
      ...overrides,
    });
  return { jobId: job!.id, startOffset, endOffset };
}

/** Scoped to the job: the clone is shared by every test in this file. */
const storedFor = (jobId: number) =>
  db().select().from(products).where(eq(products.ingestJobId, jobId)).orderBy(asc(products.id));

const chunkRow = async (jobId: number) => {
  const [found] = await db()
    .select()
    .from(ingestionChunks)
    .where(and(eq(ingestionChunks.jobId, jobId), eq(ingestionChunks.chunkIndex, 0)));
  return found;
};

/** Collects what was announced, in the order it was announced. */
function recorder() {
  const announced: (readonly number[])[] = [];
  return {
    announced,
    publish: (ids: readonly number[]) => {
      announced.push(ids);
      return Promise.resolve();
    },
  };
}

const processorWith = (publish: (ids: readonly number[]) => Promise<void>, batchSize = 100) =>
  new ChunkProcessor({
    db: db(),
    calculators: calculators(),
    publish,
    batchSize,
    reenqueue: () => Promise.resolve(),
  });

describe('ChunkProcessor', () => {
  it('prices the rows, stores them, announces them and checkpoints the chunk', async () => {
    const { jobId, endOffset } = await jobWithChunk(row(1) + row(2));
    const sink = recorder();

    const result = await processorWith(sink.publish).process({ jobId, chunkIndex: 0 });

    expect(result).toMatchObject({ claimed: true, rowsProcessed: 2, rowsRejected: 0 });
    const stored = await storedFor(jobId);
    expect(stored).toHaveLength(2);
    // 80000 +15 % markup, -3 % bulk stock, +5 % commission — the case-study row.
    expect(stored[0]?.basePriceCents).toBe(93_702);
    expect(sink.announced).toEqual([stored.map((p) => p.id)]);
    expect((await chunkRow(jobId))?.nextOffset).toBe(endOffset);
  });

  it('records where each row came from, so a stored price can be traced to a byte', async () => {
    const { jobId, startOffset } = await jobWithChunk(row(1));

    await processorWith(recorder().publish).process({ jobId, chunkIndex: 0 });

    const [stored] = await storedFor(jobId);
    expect(stored?.ingestJobId).toBe(jobId);
    expect(stored?.ingestSourceOffset).toBe(startOffset);
  });

  it('does nothing when another worker holds the lease', async () => {
    const { jobId } = await jobWithChunk(row(1));
    await claimChunk(db(), jobId, 0, 90_000);
    const sink = recorder();

    const result = await processorWith(sink.publish).process({ jobId, chunkIndex: 0 });

    expect(result.claimed).toBe(false);
    expect(sink.announced).toEqual([]);
    expect(await storedFor(jobId)).toHaveLength(0);
  });

  it('resumes at the checkpoint rather than the start of its range', async () => {
    const body = row(1) + row(2);
    const { jobId } = await jobWithChunk(body, {
      nextOffset: Buffer.byteLength(header) + Buffer.byteLength(row(1)),
    });

    const result = await processorWith(recorder().publish).process({ jobId, chunkIndex: 0 });

    expect(result.rowsProcessed).toBe(1);
    expect(await storedFor(jobId)).toHaveLength(1);
  });

  it('leaves the checkpoint unmoved when the announcement fails, so the batch replays', async () => {
    // The announcement leads the checkpoint on purpose. Checkpointing first and
    // failing to announce loses the batch silently: the rows are stored, the read
    // model never hears, and nothing replays them. This is the promotion cancel
    // bug in another costume — the event must not be the step that gets skipped.
    const { jobId, startOffset } = await jobWithChunk(row(1));

    await expect(
      processorWith(() => Promise.reject(new Error('redis is down'))).process({
        jobId,
        chunkIndex: 0,
      }),
    ).rejects.toThrow('redis is down');

    expect((await chunkRow(jobId))?.nextOffset).toBe(startOffset);
  });

  it('counts a malformed row and prices the rest of the batch', async () => {
    const { jobId } = await jobWithChunk(`${row(1)}not,enough\n${row(2)}`);

    const result = await processorWith(recorder().publish).process({ jobId, chunkIndex: 0 });

    expect(result).toMatchObject({ rowsProcessed: 2, rowsRejected: 1 });
    expect(await storedFor(jobId)).toHaveLength(2);
  });

  it('counts a row the rules price out of range, and stores the rest', async () => {
    // A vendor price so large that the markup carries it past the largest exact
    // cent value. The rules are fine; this row is not, so it is a rejection and
    // not a failure — `fault: 'row'`, counted, and the batch around it survives.
    const huge = `SKU-BIG-${sequence},big,Electronics,90071992547409.91,150\n`;
    const { jobId } = await jobWithChunk(row(1) + huge);

    const result = await processorWith(recorder().publish).process({ jobId, chunkIndex: 0 });

    expect(result).toMatchObject({ rowsProcessed: 1, rowsRejected: 1 });
    expect(await storedFor(jobId)).toHaveLength(1);
  });

  it('fails the chunk when the rule set is what is broken, so the job retries', async () => {
    // `fault: 'rules'` is not a bad row: every row after it would be rejected the
    // same way, and a chunk that quietly stored none of its rows is worse than one
    // that failed. It counts against the job's retries, not the chunk's rejections.
    const { jobId, startOffset } = await jobWithChunk(row(1));
    const broken = {
      current: () =>
        Promise.resolve(
          new BasePriceCalculator(
            { run: () => Promise.reject(new Error('rule set is unusable')) } as never,
            [1],
            1,
          ),
        ),
    };

    await expect(
      new ChunkProcessor({
        db: db(),
        calculators: broken,
        publish: recorder().publish,
        reenqueue: () => Promise.resolve(),
      }).process({ jobId, chunkIndex: 0 }),
    ).rejects.toThrow('rule set is unusable');

    expect(await storedFor(jobId)).toHaveLength(0);
    expect((await chunkRow(jobId))?.nextOffset).toBe(startOffset);
  });

  it('stops when its checkpoint is refused, because another invocation holds the chunk', async () => {
    // The lease expired while this invocation was still working, so a second one
    // claimed the chunk and is committing its own batches. The compare-and-set is
    // what stops the loser corrupting the checkpoint — but only if somebody reads
    // its answer. `checkpointBatch` returns whether it won and the processor used
    // to discard it, so a superseded worker went on pricing rows, storing them and
    // announcing them, with every checkpoint silently refused.
    const { jobId, startOffset } = await jobWithChunk(row(1) + row(2) + row(3) + row(4));
    let batches = 0;

    const superseded = new ChunkProcessor({
      db: db(),
      calculators: calculators(),
      batchSize: 2,
      reenqueue: () => Promise.resolve(),
      publish: async (ids) => {
        batches += 1;
        if (batches === 1) {
          // The other invocation commits first: the checkpoint moves under us.
          await db()
            .update(ingestionChunks)
            .set({ nextOffset: startOffset + 1 })
            .where(and(eq(ingestionChunks.jobId, jobId), eq(ingestionChunks.chunkIndex, 0)));
        }
        expect(ids.length).toBeGreaterThan(0);
      },
    });

    const result = await superseded.process({ jobId, chunkIndex: 0 });

    expect(result).toMatchObject({ claimed: true, superseded: true });
    // It returned rather than working through the remaining two batches.
    expect(batches).toBe(1);
    // And it did not roll the checkpoint back over the winner's.
    expect((await chunkRow(jobId))?.nextOffset).toBe(startOffset + 1);
  });

  it('stops on a refused checkpoint for the last partial batch too', async () => {
    // The trailing batch commits on a different line from the ones inside the
    // loop, and a chunk whose rows do not fill a batch takes only that line —
    // which is most chunks, since a file rarely divides evenly.
    const { jobId, startOffset } = await jobWithChunk(row(1));

    const superseded = new ChunkProcessor({
      db: db(),
      calculators: calculators(),
      batchSize: 100,
      reenqueue: () => Promise.resolve(),
      publish: async () => {
        await db()
          .update(ingestionChunks)
          .set({ nextOffset: startOffset + 1 })
          .where(and(eq(ingestionChunks.jobId, jobId), eq(ingestionChunks.chunkIndex, 0)));
      },
    });

    const result = await superseded.process({ jobId, chunkIndex: 0 });

    expect(result).toMatchObject({ claimed: true, superseded: true, rowsProcessed: 0 });
    expect((await chunkRow(jobId))?.status).not.toBe('done');
  });

  it('hands the chunk back and re-enqueues when the time budget is spent', async () => {
    // The serverless criterion: an invocation that runs out of time stops between
    // batches rather than being killed mid-one. It must also RELEASE the chunk —
    // holding the lease it no longer needs means the job it just enqueued finds
    // the chunk busy and returns having done nothing, so the import stalls for a
    // lease duration on every budget window.
    const { jobId, startOffset } = await jobWithChunk(row(1) + row(2) + row(3) + row(4));
    const enqueued: { jobId: number; chunkIndex: number }[] = [];
    let clock = 0;

    const result = await new ChunkProcessor({
      db: db(),
      calculators: calculators(),
      batchSize: 2,
      budgetMs: 500,
      // Zero when the invocation starts, past the budget at every later check:
      // the first batch fits and the second would not.
      now: () => (clock++ === 0 ? 0 : 1000),
      reenqueue: (chunk) => {
        enqueued.push(chunk);
        return Promise.resolve();
      },
      publish: () => Promise.resolve(),
    }).process({ jobId, chunkIndex: 0 });

    expect(result).toMatchObject({ claimed: true, exhausted: true, rowsProcessed: 2 });
    expect(enqueued).toEqual([{ jobId, chunkIndex: 0 }]);

    const chunk = await chunkRow(jobId);
    expect(chunk?.nextOffset).toBe(startOffset + Buffer.byteLength(row(1) + row(2)));
    expect(chunk?.status).toBe('pending');
    expect(chunk?.leaseUntil).toBeNull();
  });

  it('does not re-enqueue a chunk the spent budget happened to finish', async () => {
    // Budget exhausted and no bytes left is a completed chunk, not a hand-off.
    // Re-enqueueing here costs a redelivery that claims nothing and returns.
    const { jobId } = await jobWithChunk(row(1) + row(2));
    const enqueued: unknown[] = [];
    let clock = 0;

    const result = await new ChunkProcessor({
      db: db(),
      calculators: calculators(),
      batchSize: 2,
      budgetMs: 500,
      now: () => (clock++ === 0 ? 0 : 1000),
      reenqueue: (chunk) => {
        enqueued.push(chunk);
        return Promise.resolve();
      },
      publish: () => Promise.resolve(),
    }).process({ jobId, chunkIndex: 0 });

    expect(result).toMatchObject({ claimed: true, rowsProcessed: 2 });
    expect(result.exhausted).toBeFalsy();
    expect(enqueued).toEqual([]);
    expect((await chunkRow(jobId))?.status).toBe('done');
  });

  it('completes the job when the chunk it finished was the last one', async () => {
    const { jobId } = await jobWithChunk(row(1));

    await processorWith(recorder().publish).process({ jobId, chunkIndex: 0 });

    const [job] = await db().select().from(ingestionJobs).where(eq(ingestionJobs.id, jobId));
    expect(job?.status).toBe('completed');
  });

  it('marks the chunk done once the checkpoint reaches the end of its range', async () => {
    const { jobId } = await jobWithChunk(row(1));

    await processorWith(recorder().publish).process({ jobId, chunkIndex: 0 });

    expect((await chunkRow(jobId))?.status).toBe('done');
  });

  it('announces once per batch rather than once per chunk', async () => {
    const { jobId } = await jobWithChunk(row(1) + row(2) + row(3) + row(4) + row(5));
    const sink = recorder();

    await processorWith(sink.publish, 2).process({ jobId, chunkIndex: 0 });

    expect(sink.announced.map((ids) => ids.length)).toEqual([2, 2, 1]);
    expect(await storedFor(jobId)).toHaveLength(5);
  });

  it('checkpoints each batch as it goes, so a kill costs one batch and not the chunk', async () => {
    const body = row(1) + row(2) + row(3) + row(4);
    const { jobId, startOffset } = await jobWithChunk(body);
    let batches = 0;

    await expect(
      processorWith(() => {
        batches += 1;
        return batches === 2 ? Promise.reject(new Error('killed')) : Promise.resolve();
      }, 2).process({ jobId, chunkIndex: 0 }),
    ).rejects.toThrow('killed');

    // The first batch committed. The second stored its rows — the upsert runs before
    // the announcement — but never announced and so never checkpointed, which is the
    // safe order: the replay re-stores the same four rows under the same SKUs and
    // announces them, where the reverse order would have lost the announcement.
    expect((await chunkRow(jobId))?.nextOffset).toBe(
      startOffset + Buffer.byteLength(row(1) + row(2)),
    );
    expect(await storedFor(jobId)).toHaveLength(4);
  });
});
