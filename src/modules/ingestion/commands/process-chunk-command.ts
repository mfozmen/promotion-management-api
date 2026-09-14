import { join } from 'node:path';
import { TransactionRollbackError } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../../../shared/db/client.js';
import { IngestionRepository } from '../db/ingestion-repository.js';
import type { ProductRepository } from '../../product/db/product-repository.js';
import type { ProductUpsert } from '../../product/domain/dto/product-upsert.js';
import type { BasePriceCalculatorCache } from '../../pricing/domain/base-price-calculator-cache.js';
import type { ChunkOutcome } from '../domain/dto/chunk-outcome.js';
import type { ChunkProcess } from '../events/chunk-process.js';
import { parseVendorRow } from '../domain/parse-vendor-row.js';
import { readRangeLines } from '../domain/read-range-lines.js';

/** What a chunk has stored and rejected so far, carried through its batches. */
interface Totals {
  rowsProcessed: number;
  rowsRejected: number;
}

/** A batch, and the offset the checkpoint moves to when it commits. */
interface Batch {
  rows: ProductUpsert[];
  /** The checkpoint this batch expects to find, and the offset it moves past. */
  seenOffset: number;
  nextOffset: number;
  rejected: number;
}

/**
 * Runs one chunk of a vendor import, a batch at a time: claim, read from the
 * checkpoint, price, store, announce, checkpoint.
 */
export class ProcessChunkCommand {
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
  /** This process's view of where vendor files live; the stored ref is relative to it. */
  private readonly uploadDir: string;
  /** Every query this command makes against the ingestion tables. */
  private readonly ingestion: IngestionRepository;
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
    uploadDir: string;
    budgetMs?: number;
    now?: () => number;
  }) {
    this.db = options.db;
    this.calculators = options.calculators;
    this.products = options.products;
    this.publish = options.publish;
    this.log = options.log;
    this.reenqueue = options.reenqueue;
    this.batchSize = options.batchSize ?? ProcessChunkCommand.DEFAULT_BATCH_SIZE;
    this.leaseMs = options.leaseMs ?? ProcessChunkCommand.DEFAULT_LEASE_MS;
    this.uploadDir = options.uploadDir;
    this.ingestion = new IngestionRepository(options.db);
    this.budgetMs = options.budgetMs ?? Number.POSITIVE_INFINITY;
    this.now = options.now ?? Date.now;
  }

  async process({ jobId, chunkIndex }: ChunkProcess): Promise<ChunkOutcome> {
    const claimed = await this.ingestion.claimChunk(jobId, chunkIndex, this.leaseMs);
    // A duplicate delivery is the ordinary path, not an error.
    if (claimed === null) return { claimed: false, rowsProcessed: 0, rowsRejected: 0 };

    // A claimed chunk proves the job: the foreign key does not cascade.
    const job = (await this.ingestion.findIngestionJob(jobId))!;

    const calculator = await this.calculators.current();
    const startedAt = this.now();
    let batch: Batch = this.emptyBatch(claimed.nextOffset);
    let rowStart = claimed.nextOffset;
    let totals: Totals = { rowsProcessed: 0, rowsRejected: 0 };

    for await (const { line, endOffset } of readRangeLines(
      join(this.uploadDir, job.fileRef),
      claimed.nextOffset,
      claimed.endOffset,
    )) {
      const priced = await this.price(calculator, line, jobId, rowStart);
      rowStart = endOffset;
      batch.nextOffset = endOffset;
      if (priced === undefined) batch.rejected += 1;
      else batch.rows.push(priced);

      if (batch.rows.length + batch.rejected < this.batchSize) continue;

      const committed = await this.commitInto(totals, jobId, chunkIndex, batch);
      if (committed === null) return { claimed: true, superseded: true, ...totals };
      totals = committed;
      batch = this.emptyBatch(endOffset);

      // Between batches is the only safe place to stop: the checkpoint is
      // committed, so the next invocation resumes from it having lost nothing.
      if (this.outOfTime(startedAt, endOffset, claimed.endOffset)) {
        await this.ingestion.releaseChunk(jobId, chunkIndex, claimed.leaseUntil);
        await this.reenqueue({ jobId, chunkIndex });
        return { claimed: true, exhausted: true, ...totals };
      }
    }

    if (batch.rows.length + batch.rejected > 0) {
      const committed = await this.commitInto(totals, jobId, chunkIndex, batch);
      if (committed === null) return { claimed: true, superseded: true, ...totals };
      totals = committed;
    }

    // Counters before status, or a `completed` job is briefly readable reporting
    // that it processed nothing.
    await this.ingestion.refreshJobProgress(jobId);
    await this.ingestion.completeJobIfDone(jobId);

    return { claimed: true, ...totals };
  }

  /** Null when the compare-and-set was refused: this invocation has lost the chunk. */
  private async commitInto(
    totals: Totals,
    jobId: number,
    chunkIndex: number,
    batch: Batch,
  ): Promise<Totals | null> {
    const stored = await this.commit(jobId, chunkIndex, batch);
    if (stored === null) return null;

    return {
      rowsProcessed: totals.rowsProcessed + stored,
      rowsRejected: totals.rowsRejected + batch.rejected,
    };
  }

  /** Out of budget with bytes left: a hand-off, rather than a chunk that finished. */
  private outOfTime(startedAt: number, endOffset: number, chunkEnd: number): boolean {
    return this.now() - startedAt >= this.budgetMs && endOffset < chunkEnd;
  }

  private emptyBatch(at: number): Batch {
    return { rows: [], seenOffset: at, nextOffset: at, rejected: 0 };
  }

  /**
   * Prices one row, or returns undefined because the row was the problem. A
   * `rules` fault throws instead: every row after it would be rejected too, and a
   * chunk that quietly stored none of its rows is worse than one that failed.
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
   * The write and the checkpoint are one transaction, so an invocation that has
   * lost the chunk stores nothing. The announcement follows the commit and its
   * failure is logged rather than thrown: a lost announcement delays a derivable
   * projection, while a superseded write corrupts the store it derives from.
   */
  private async commit(jobId: number, chunkIndex: number, batch: Batch): Promise<number | null> {
    let ids: readonly number[] = [];

    try {
      await this.db.transaction(async (tx) => {
        ids = await this.products.upsertMany(tx, batch.rows);
        const moved = await this.ingestion.checkpointBatch(tx, {
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

    // Throwing here would fail the job after the data was safe, and the retry
    // resumes past this batch anyway. The log line is how a stale entry is found.
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
