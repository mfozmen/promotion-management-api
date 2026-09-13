import type { ProductReadRepository } from '../db/product-read-repository.js';
import type { ProductSourceRepository } from '../db/product-source-repository.js';
import type { ProductWriteRepository } from '../db/product-write-repository.js';
import type { ProductUpserted } from '../../product/events/product-upserted.js';

/** Recomputes the read-model entry for every product an announcement named.
 *  One read of PostgreSQL for the batch, so one instant orders the whole of it
 *  (ADR-0003); an id the read did not return has been deleted since the
 *  announcement, which an at-least-once queue makes ordinary. */
export class ProductUpsertedHandler {
  constructor(
    private readonly source: ProductSourceRepository,
    private readonly readModel: ProductWriteRepository,
    private readonly stored: ProductReadRepository,
  ) {}

  async handle({ productIds }: ProductUpserted): Promise<void> {
    const { rows, sourceReadAt } = await this.source.read(productIds);
    const found = new Map(rows.map((row) => [row.id, row]));

    for (const id of productIds) {
      const row = found.get(id);

      if (row === undefined) {
        await this.removeDeleted(id, sourceReadAt);
        continue;
      }

      await this.readModel.write(
        {
          id: row.id,
          sku: row.sku,
          name: row.name,
          category: row.category,
          basePriceCents: row.basePriceCents,
          // No resolver yet: a promotion discounts nothing until PR 2, and the
          // storefront serves none of this until the rebuild publishes ready.
          effectivePriceCents: row.basePriceCents,
          stockQuantity: row.stockQuantity,
          ...(row.pricingRulesVersion === null
            ? {}
            : { pricingRulesVersion: row.pricingRulesVersion }),
        },
        sourceReadAt,
      );
    }
  }

  /** A deleted row cannot say which category it was in, so the entry that is
   *  about to go says it instead. An entry already gone needs no removal, and
   *  the token stands either way. */
  private async removeDeleted(id: number, sourceReadAt: string): Promise<void> {
    const entry = await this.stored.find(id);

    if (entry?.category !== undefined)
      await this.readModel.remove(id, entry.category, sourceReadAt);
  }
}
