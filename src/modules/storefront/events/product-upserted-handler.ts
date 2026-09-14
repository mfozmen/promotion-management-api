import type { Logger } from 'pino';
import type { ProductSourceRepository } from '../db/product-source-repository.js';
import type { ProductEntry, ProductWriteRepository } from '../db/product-write-repository.js';
import type { ProductUpserted } from '../../product/events/product-upserted.js';

/** Recomputes the read-model entry for every product an announcement named.
 *  One read of PostgreSQL for the batch, so one instant orders the whole of it
 *  (ADR-0003); an id the read did not return has been deleted since the
 *  announcement, which an at-least-once queue makes ordinary. */
export class ProductUpsertedHandler {
  constructor(
    private readonly source: ProductSourceRepository,
    private readonly readModel: ProductWriteRepository,
    private readonly logger: Logger,
  ) {}

  async handle({ productIds }: ProductUpserted): Promise<void> {
    const { rows, sourceReadAt } = await this.source.read(productIds);
    const found = new Map(rows.map((row) => [row.id, row]));
    const deleted = productIds.filter((id) => !found.has(id));

    const entries = [...found.values()].map((row): ProductEntry => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      category: row.category,
      basePriceCents: row.basePriceCents,
      // No resolver yet: a promotion discounts nothing until PR 2, and the
      // storefront serves none of this until the rebuild publishes ready.
      effectivePriceCents: row.basePriceCents,
      stockQuantity: row.stockQuantity,
      ...(row.pricingRulesVersion === null ? {} : { pricingRulesVersion: row.pricingRulesVersion }),
    }));

    this.report(
      sourceReadAt,
      entries.map((entry) => entry.id),
      await this.readModel.writeAll(entries, sourceReadAt),
    );
    this.report(sourceReadAt, deleted, await this.readModel.removeAll(deleted, sourceReadAt));
  }

  /** A refused write is ordinary and does not fail the batch, but unrecorded it
   *  is indistinguishable from an inversion, and ADR-0003 clause 4 asks for the
   *  count before it will widen the token. */
  private report(sourceReadAt: string, ids: readonly number[], applied: readonly boolean[]): void {
    const refused = ids.filter((_, index) => !applied[index]);

    if (refused.length > 0)
      this.logger.warn(
        { productIds: refused, sourceReadAt },
        'read-model write refused by a newer or equal token',
      );
  }
}
