import { inArray, sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import { products } from '../../product/db/schema/products.js';

export interface SourceRow {
  id: number;
  sku: string;
  name: string;
  category: string;
  basePriceCents: number;
  stockQuantity: number;
  pricingRulesVersion: number | null;
}

/** Epoch microseconds as digits: two renderings of a timestamp do not compare,
 *  and `clock_timestamp()::text` follows the session `TimeZone` (ADR-0003). */
const INSTANT = sql<string>`(extract(epoch from clock_timestamp()) * 1000000)::bigint::text`;

/** The rows a recompute works from, and the instant PostgreSQL read them. The
 *  instant comes from `clock_timestamp()` in the same statement as the SELECT,
 *  so it is the database's clock and not a worker's (ADR-0003). */
export class ProductSourceRepository {
  constructor(private readonly db: Db) {}

  async read(ids: readonly number[]): Promise<{ rows: SourceRow[]; sourceReadAt: string }> {
    const selected = await this.db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        category: products.category,
        basePriceCents: products.basePriceCents,
        stockQuantity: products.stockQuantity,
        pricingRulesVersion: products.pricingRulesVersion,
        sourceReadAt: INSTANT,
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
      sourceReadAt: selected[0]?.sourceReadAt ?? (await this.instant()),
    };
  }

  /** An empty batch still orders its removals, and the same clock has to render
   *  it: a worker's own would outrank every token PostgreSQL ever wrote. */
  private async instant(): Promise<string> {
    const { rows } = await this.db.execute<{ sourceReadAt: string }>(
      sql`select ${INSTANT} as "sourceReadAt"`,
    );

    return rows[0]!.sourceReadAt;
  }
}
