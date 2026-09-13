import { TransactionRollbackError } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../../../shared/db/client.js';
import type { ProductRepository } from '../../product/db/product-repository.js';
import type { ProductUpsert } from '../../product/domain/dto/product-upsert.js';
import type { BasePriceCalculatorCache } from '../../pricing/domain/base-price-calculator-cache.js';
import { checkpointBatch } from '../db/checkpoint-batch.js';
import { claimChunk } from '../db/claim-chunk.js';
import { completeJobIfDone } from '../db/complete-job-if-done.js';
import { refreshJobProgress } from '../db/refresh-job-progress.js';
import { releaseChunk } from '../db/release-chunk.js';
import { findIngestionJob } from '../db/find-ingestion-job.js';
import type { ChunkOutcome } from '../domain/dto/chunk-outcome.js';
import type { ChunkProcess } from '../events/chunk-process.js';
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
  /**
   * The batch the acceptance criteria name, and the number the memory budget was
   * measured against: 1 000 rows held at once, one statement, one announcement.
   */
  static readonly DEFAULT_BATCH_SIZE = 1000;
  static readonly DEFAULT_LEASE_MS = 90_000;

  private readonly db: Db;
  /** Only `current` is used, so a test can supply a rule set that fails on purpose. */
  private readonly calculators: Pick<BasePriceCalculatorCache, 'current'>;
  /** Only `upsertMany` is used: the module that owns the table owns the write. */
  private readonly products: Pick<ProductRepository, 'upsertMany'>;
  private readonly publish: (productIds: readonly number[]) => Promise<unknown>;
  /** Only `error` is used: the one line an operator finds a lost announcement by. */
  private readonly log: Pick<Logger, 'error'>;
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly budgetMs: number;
  private readonly now: () => number;
  private readonly reenqueue: (chunk: ChunkProcess) => Promise<unknown>;

  constructor(options: {
    db: Db;
    calculators: Pick<BasePriceCalculatorCache, 'current'>;
    products: Pick<ProductRepository, 'upsertMany'>;
    publish: (productIds: readonly number[]) => Promise<unknown>;
    log: Pick<Logger, 'error'>;
    /**
     * Enqueues the next invocation for a chunk this one ran out of time on.
     * Required rather than defaulted: a processor that cannot hand off is one
     * whose budget silently does nothing, and the default would be a function
     * no caller ever reaches.
     */
    reenqueue: (chunk: ChunkProcess) => Promise<unknown>;
    batchSize?: number;
    leaseMs?: number;
    budgetMs?: number;
    now?: () => number;
  }) {
    this.db = options.db;
    this.calculators = options.calculators;
    this.products = options.products;
    this.publish = options.publish;
    this.log = options.log;
    this.reenqueue = options.reenqueue;
    this.batchSize = options.batchSize ?? ChunkProcessor.DEFAULT_BATCH_SIZE;
    this.leaseMs = options.leaseMs ?? ChunkProcessor.DEFAULT_LEASE_MS;
    this.budgetMs = options.budgetMs ?? Number.POSITIVE_INFINITY;
    this.now = options.now ?? Date.now;
  }

  async process({ jobId, chunkIndex }: ChunkProcess): Promise<ChunkOutcome> {
    const claimed = await claimChunk(this.db, jobId, chunkIndex, this.leaseMs);
    // A duplicate delivery is the ordinary path, not an error: the registration step
    // enqueues one job per chunk and a redelivery costs nothing.
    if (claimed === null) return { claimed: false, rowsProcessed: 0, rowsRejected: 0 };

    // A claimed chunk proves the job: `ingestion_chunks.job_id` carries a foreign key
    // to it and nothing cascades, so the row cannot outlive what it points at.
    const job = (await findIngestionJob(this.db, jobId))!;

    const calculator = await this.calculators.current();
    const startedAt = this.now();
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
        const stored = await this.commit(jobId, chunkIndex, batch);
        if (stored === null) {
          return { claimed: true, superseded: true, rowsProcessed, rowsRejected };
        }
        rowsProcessed += stored;
        rowsRejected += batch.rejected;
        batch = this.emptyBatch(endOffset);

        // Between batches is the only safe place to stop: the checkpoint is
        // committed, so the next invocation resumes from it having lost nothing.
        if (this.now() - startedAt >= this.budgetMs && endOffset < claimed.endOffset) {
          await releaseChunk(this.db, jobId, chunkIndex, claimed.leaseUntil);
          await this.reenqueue({ jobId, chunkIndex });
          return { claimed: true, exhausted: true, rowsProcessed, rowsRejected };
        }
      }
    }

    if (batch.rows.length + batch.rejected > 0) {
      const stored = await this.commit(jobId, chunkIndex, batch);
      if (stored === null) {
        return { claimed: true, superseded: true, rowsProcessed, rowsRejected };
      }
      rowsProcessed += stored;
      rowsRejected += batch.rejected;
    }

    // The checkpoint reached the end of the range, so this chunk is done. Its
    // counters go up to the job before the status does, or a `completed` job is
    // readable for an instant reporting that it processed nothing.
    await refreshJobProgress(this.db, jobId);
    // The job is completed by whichever chunk was last, and only one call wins.
    await completeJobIfDone(this.db, jobId);

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
      if (priced.fault === 'rules')
        throw new Error(`pricing rules rejected a row: ${priced.reason}`);
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

  /**
   * How many products the batch stored, or null because the compare-and-set was
   * refused and this invocation no longer holds the chunk.
   *
   * The write and the checkpoint are one transaction, so an invocation that has
   * lost the chunk stores nothing: its CAS fails and its rows roll back with it.
   * Without that, a batch already in flight when the lease expired still landed —
   * the loop stopped, the batch did not — and its rows would overwrite the
   * winner's, permanently, if it had been pricing against an older rule set.
   *
   * The announcement follows the commit and its failure is not fatal, which is
   * what every other write path here does. The cost is real and stated in the
   * pull request: a batch that commits and then fails to publish leaves a stale
   * read-model entry with nothing to repair it until the rebuild or the
   * reconciler exists. That is a delay in a derivable projection; the ordering it
   * replaces risked the store the projection derives from, which replaying
   * cannot fix.
   */
  private async commit(jobId: number, chunkIndex: number, batch: Batch): Promise<number | null> {
    let ids: readonly number[] = [];

    try {
      await this.db.transaction(async (tx) => {
        ids = await this.products.upsertMany(tx, batch.rows);
        const moved = await checkpointBatch(tx, {
          jobId,
          chunkIndex,
          seenOffset: batch.seenOffset,
          nextOffset: batch.nextOffset,
          // `ids.length`, not `batch.rows.length`: a vendor file repeating a SKU
          // inside one batch stores one product for two lines.
          rowsProcessed: ids.length,
          rowsRejected: batch.rejected,
        });
        if (!moved) tx.rollback();
      });
    } catch (error) {
      if (error instanceof TransactionRollbackError) return null;
      throw error;
    }

    // Swallowed on purpose. The rows are committed; throwing here would fail the
    // job after the data was safe, and the retry resumes past this batch anyway,
    // so the announcement is lost either way and the failure is spurious. The log
    // line is what an operator has to find a stale read-model entry by.
    if (ids.length > 0) {
      await this.publish(ids).catch((error: unknown) => {
        this.log.error(
          { jobId, chunkIndex, productIds: ids.length, err: error },
          'product.upserted could not be enqueued; these products stay stale in the read model until a rebuild',
        );
      });
    }

    return ids.length;
  }
}
