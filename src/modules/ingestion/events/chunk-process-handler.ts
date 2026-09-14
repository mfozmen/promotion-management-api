import type { Logger } from 'pino';
import type { Db } from '../../../shared/db/client.js';
import type { ProductRepository } from '../../product/db/product-repository.js';
import type { BasePriceCalculatorCache } from '../../pricing/domain/base-price-calculator-cache.js';
import type { ChunkOutcome } from '../domain/dto/chunk-outcome.js';
import { chunkProcess, type ChunkProcess } from '../events/chunk-process.js';
import { ProcessChunkCommand } from '../commands/process-chunk-command.js';

/**
 * One `chunk.process` job: parse what the queue delivered, then run the chunk.
 *
 * The parse is the point of this class rather than a formality. The queue is
 * at-least-once and its payloads outlive the code that wrote them, so a job from
 * an older producer must fail here rather than reach `claimChunk` with an
 * undefined index and claim something nobody asked for.
 */
export class ChunkProcessHandler {
  /**
   * One chunk at a time per worker. A chunk is already the unit of parallelism —
   * more workers take more chunks — so a second concurrent job inside one worker
   * buys nothing and doubles the heap the memory budget was measured against.
   */
  static readonly CONCURRENCY = 1;

  /** The margin between the lock and the budget, for the hand-off to finish in. */
  static readonly LOCK_GRACE_MS = 30_000;

  private readonly processor: ProcessChunkCommand;

  constructor(options: {
    db: Db;
    products: Pick<ProductRepository, 'upsertMany'>;
    calculators: Pick<BasePriceCalculatorCache, 'current'>;
    publish: (productIds: readonly number[]) => Promise<unknown>;
    reenqueue: (chunk: ChunkProcess) => Promise<unknown>;
    log: Pick<Logger, 'error'>;
    batchSize?: number;
    budgetMs?: number;
    leaseMs?: number;
    maxFailures?: number;
    uploadDir: string;
  }) {
    this.processor = new ProcessChunkCommand(options);
  }

  /**
   * How long BullMQ should hold the job lock, given the budget the invocation
   * gets. It has to outlast the budget: a lock that expires first hands the same
   * chunk to a second worker while the first is still inside a batch, which is
   * the lease race arriving from the queue instead of from the database.
   */
  static lockDurationFor(budgetMs: number): number {
    return budgetMs + ChunkProcessHandler.LOCK_GRACE_MS;
  }

  async handle(payload: unknown): Promise<ChunkOutcome> {
    return this.processor.process(chunkProcess.parse(payload));
  }
}
