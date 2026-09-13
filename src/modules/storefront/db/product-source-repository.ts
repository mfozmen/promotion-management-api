import { inArray, sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { products } from '../../product/db/schema/products.js';
import type { SourceReadAt } from './product-write-repository.js';

export interface SourceRow {
  id: number;
  sku: string;
  name: string;
  category: string;
  basePriceCents: number;
  stockQuantity: number;
  pricingRulesVersion: number | null;
}

/** The rows a recompute works from, and the instant PostgreSQL read them. The
 *  instant comes from `clock_timestamp()` in the same statement as the SELECT,
 *  so it is the database's clock and not a worker's (ADR-0003). */
export class ProductSourceRepository {
  constructor(private readonly db: Db) {}

  async read(ids: readonly number[]): Promise<{ rows: SourceRow[]; sourceReadAt: SourceReadAt }> {
    const selected = await this.db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        category: products.category,
        basePriceCents: products.basePriceCents,
        stockQuantity: products.stockQuantity,
        pricingRulesVersion: products.pricingRulesVersion,
        sourceReadAt: sql<string>`clock_timestamp()::text`,
      })
      .from(products)
      .where(inArray(products.id, [...ids]));

    return {
      // The instant rides on every row and belongs to the batch, not to any
      // one of them.
      rows: selected.map(
        ({ id, sku, name, category, basePriceCents, stockQuantity, pricingRulesVersion }) => ({
          id,
          sku,
          name,
          category,
          basePriceCents,
          stockQuantity,
          pricingRulesVersion,
        }),
      ),
      // Every row carries the same instant; an empty batch still needs one, and
      // a second statement to fetch it would be a second instant.
      sourceReadAt: selected[0]?.sourceReadAt ?? new Date().toISOString(),
    };
  }
}
