import type { Db } from '../../../shared/db/client.js';
import { upsertProducts, type ProductUpsert } from '../../catalog/db/upsert-products.js';
import type { BasePriceCalculatorCache } from '../../pricing/domain/base-price-calculator-cache.js';
import { checkpointBatch } from '../db/checkpoint-batch.js';
import { claimChunk } from '../db/claim-chunk.js';
import { findIngestionJob } from '../db/find-ingestion-job.js';
import type { ChunkOutcome } from '../domain/dto/chunk-outcome.js';
import type { IngestionChunk } from '../domain/dto/ingestion-chunk.js';
import { parseVendorRow } from '../domain/parse-vendor-row.js';
import { readRangeLines } from '../domain/read-range-lines.js';

/** A batch, and the offset the checkpoint moves to when it commits. */
interface Batch {
  rows: ProductUpsert[];
  /** The checkpoint this batch expects to find, and the offset it moves past. */
  seenOffset: number;
  nextOffset: number;
  rejected: number;
}

/**
 * Runs one chunk of a vendor import: claim it, read its rows from where it left
 * off, price them, store them, announce them and checkpoint — a batch at a time.
 *
 * The order inside a batch is store, announce, checkpoint, and it is deliberate.
 * Checkpointing first and then failing to announce loses the batch in silence: the
 * rows are stored, the read model never hears about them, and nothing replays them.
 * Announcing first costs a duplicate announcement after a kill, which recomputes the
 * same prices — the read model is idempotent and silence is not.
 */
export class ChunkProcessor {
  static readonly DEFAULT_BATCH_SIZE = 500;
  static readonly DEFAULT_LEASE_MS = 90_000;

  private readonly db: Db;
  /** Only `current` is used, so a test can supply a rule set that fails on purpose. */
  private readonly calculators: Pick<BasePriceCalculatorCache, 'current'>;
  private readonly publish: (productIds: readonly number[]) => Promise<unknown>;
  private readonly batchSize: number;
  private readonly leaseMs: number;

  constructor(options: {
    db: Db;
    calculators: Pick<BasePriceCalculatorCache, 'current'>;
    publish: (productIds: readonly number[]) => Promise<unknown>;
    batchSize?: number;
    leaseMs?: number;
  }) {
    this.db = options.db;
    this.calculators = options.calculators;
    this.publish = options.publish;
    this.batchSize = options.batchSize ?? ChunkProcessor.DEFAULT_BATCH_SIZE;
    this.leaseMs = options.leaseMs ?? ChunkProcessor.DEFAULT_LEASE_MS;
  }

  async process({ jobId, chunkIndex }: IngestionChunk): Promise<ChunkOutcome> {
    const claimed = await claimChunk(this.db, jobId, chunkIndex, this.leaseMs);
    // A duplicate delivery is the ordinary path, not an error: the registration step
    // enqueues one job per chunk and a redelivery costs nothing.
    if (claimed === null) return { claimed: false, rowsProcessed: 0, rowsRejected: 0 };

    // A claimed chunk proves the job: `ingestion_chunks.job_id` carries a foreign key
    // to it and nothing cascades, so the row cannot outlive what it points at.
    const job = (await findIngestionJob(this.db, jobId))!;

    const calculator = await this.calculators.current();
    let batch: Batch = this.emptyBatch(claimed.nextOffset);
    let rowStart = claimed.nextOffset;
    let rowsProcessed = 0;
    let rowsRejected = 0;

    for await (const { line, endOffset } of readRangeLines(
      job.fileRef,
      claimed.nextOffset,
      claimed.endOffset,
    )) {
      const priced = await this.price(calculator, line, jobId, rowStart);
      rowStart = endOffset;
      batch.nextOffset = endOffset;
      if (priced === undefined) batch.rejected += 1;
      else batch.rows.push(priced);

      if (batch.rows.length + batch.rejected >= this.batchSize) {
        await this.commit(jobId, chunkIndex, batch);
        rowsProcessed += batch.rows.length;
        rowsRejected += batch.rejected;
        batch = this.emptyBatch(endOffset);
      }
    }

    if (batch.rows.length + batch.rejected > 0) {
      await this.commit(jobId, chunkIndex, batch);
      rowsProcessed += batch.rows.length;
      rowsRejected += batch.rejected;
    }

    return { claimed: true, rowsProcessed, rowsRejected };
  }

  private emptyBatch(at: number): Batch {
    return { rows: [], seenOffset: at, nextOffset: at, rejected: 0 };
  }

  /**
   * Prices one row, or returns undefined because the row was the problem.
   *
   * Sequential over the batch rather than concurrent: the rules engine is one
   * compiled rule set and a batch is bounded, so the parallelism would buy nothing
   * and cost the order the offsets depend on (ADR-0005).
   *
   * A `rules` fault throws instead. A broken rule set is not a bad row — every row
   * after it would be rejected too, and a chunk that quietly stored none of its
   * rows is worse than a chunk that failed.
   */
  private async price(
    calculator: Awaited<ReturnType<BasePriceCalculatorCache['current']>>,
    line: string,
    jobId: number,
    sourceOffset: number,
  ): Promise<ProductUpsert | undefined> {
    const parsed = parseVendorRow(line);
    if (!parsed.ok) return undefined;

    const priced = await calculator.calculate(parsed.row);
    if (!priced.ok) {
      if (priced.fault === 'rules') throw new Error(`pricing rules rejected a row: ${priced.reason}`);
      return undefined;
    }

    return {
      sku: parsed.row.sku,
      name: parsed.row.name,
      category: parsed.row.category,
      basePriceCents: priced.basePriceCents,
      stockQuantity: parsed.row.stockQuantity,
      pricingRulesVersion: priced.pricingRulesVersion,
      ingestJobId: jobId,
      ingestSourceOffset: sourceOffset,
    };
  }

  private async commit(jobId: number, chunkIndex: number, batch: Batch): Promise<void> {
    const ids = await upsertProducts(this.db, batch.rows);
    if (ids.length > 0) await this.publish(ids);
    await checkpointBatch(this.db, {
      jobId,
      chunkIndex,
      seenOffset: batch.seenOffset,
      nextOffset: batch.nextOffset,
      rowsProcessed: batch.rows.length,
      rowsRejected: batch.rejected,
    });
  }
}
