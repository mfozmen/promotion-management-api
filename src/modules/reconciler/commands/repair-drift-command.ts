import type { Logger } from 'pino';

interface Catalogue {
  categoryCounts(): Promise<Map<string, number>>;
}

interface ReadModel {
  count(category?: string): Promise<number>;
}

interface Rebuild {
  rebuildCategory(category: string): Promise<number>;
}

interface Repairs {
  inc(): void;
}

/**
 * The safety net under the safety net. The boundary sweep repairs an announcement
 * that was never published; nothing repairs a write that was published, consumed
 * and lost — a key evicted, a `FLUSHDB`, a partial restore. Comparing what each
 * store says it holds is the only way to notice, because no event was missed.
 *
 * It compares counts rather than prices: a count is one `ZCARD` against one
 * grouped query, and every loss this can see moves one. A price that drifted
 * without a membership changing is beyond it, and the sampled check ADR-0007
 * describes is what would find that.
 */
export class RepairDriftCommand {
  constructor(
    private readonly catalogue: Catalogue,
    private readonly readModel: ReadModel,
    private readonly rebuild: Rebuild,
    private readonly repairs: Repairs,
    private readonly logger: Logger,
  ) {}

  /** Returns the number of categories repaired, so a caller can log one line. */
  async execute(): Promise<number> {
    const expected = await this.catalogue.categoryCounts();
    let repaired = 0;

    for (const [category, products] of expected) {
      const listed = await this.readModel.count(category);
      if (listed === products) continue;

      // Scoped, never a full rebuild: a category that lost a key should not cost
      // the catalogue, and the flash-sale path is the one this runs beside.
      const recomputed = await this.rebuild.rebuildCategory(category);
      repaired += 1;
      this.repairs.inc();
      this.logger.warn({ category, products, listed, recomputed }, 'read model drift repaired');
    }

    return repaired;
  }
}
