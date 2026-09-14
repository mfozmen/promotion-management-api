import { sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/client.js';
import type { PromotionCandidate } from '../domain/dto/promotion-candidate.js';
import type { SourceRow } from '../domain/dto/source-row.js';

/** Epoch microseconds as digits, because two renderings do not compare (ADR-0003). */
const INSTANT = sql`(extract(epoch from clock_timestamp()) * 1000000)::bigint::text`;

type SelectedRow = Record<string, unknown> & {
  id: number;
  sku: string;
  name: string;
  category: string;
  base_price_cents: number;
  stock_quantity: number;
  pricing_rules_version: number | null;
  product_promotion: PromotionCandidate | null;
  category_promotion: PromotionCandidate | null;
  source_read_at: string;
};

const CANDIDATE = (alias: string) =>
  sql.raw(`
  case when ${alias}.id is null then null else
    json_build_object('id', ${alias}.id, 'name', ${alias}.name,
                      'discountType', ${alias}.discount_type, 'value', ${alias}.value)
  end`);

/** The rows a recompute works from, their candidate promotions and the instant
 *  PostgreSQL read all of it, in one statement (ADR-0003). */
export class ProductSourceRepository {
  static readonly PAGE = 1_000;

  constructor(private readonly db: Db) {}

  async read(ids: readonly number[]): Promise<{ rows: SourceRow[]; sourceReadAt: string }> {
    const { rows: selected } = await this.db.execute<SelectedRow>(sql`
      select p.id, p.sku, p.name, p.category, p.base_price_cents, p.stock_quantity,
             p.pricing_rules_version,
             ${CANDIDATE('pp')} as product_promotion,
             ${CANDIDATE('cp')} as category_promotion,
             ${INSTANT} as source_read_at
      from products p
      left join active_promotions pp on pp.product_id = p.id
      left join active_promotions cp on cp.category = p.category
      where p.id = any(${sql.param(ids)}::bigint[])
    `);

    return {
      rows: selected.map((row) => ({
        id: Number(row.id),
        sku: row.sku,
        name: row.name,
        category: row.category,
        basePriceCents: Number(row.base_price_cents),
        stockQuantity: Number(row.stock_quantity),
        pricingRulesVersion:
          row.pricing_rules_version === null ? null : Number(row.pricing_rules_version),
        productPromotion: row.product_promotion,
        categoryPromotion: row.category_promotion,
      })),
      sourceReadAt: selected[0]?.source_read_at ?? (await this.instant()),
    };
  }

  /** Keyset, never OFFSET: an OFFSET scan re-reads every row it skipped. */
  async idsInCategory(category: string, afterId: number): Promise<number[]> {
    const { rows } = await this.db.execute<Record<string, unknown> & { id: number }>(sql`
      select id from products
      where category = ${category} and id > ${afterId}
      order by id
      limit ${ProductSourceRepository.PAGE}
    `);

    return rows.map((row) => Number(row.id));
  }

  async idsAfter(afterId: number): Promise<number[]> {
    const { rows } = await this.db.execute<Record<string, unknown> & { id: number }>(sql`
      select id from products where id > ${afterId} order by id
      limit ${ProductSourceRepository.PAGE}
    `);

    return rows.map((row) => Number(row.id));
  }

  /** Which of these ids PostgreSQL still holds, so the rebuild recomputes only
   *  the read-model entries that have nothing behind them. */
  async presentIds(ids: readonly number[]): Promise<Set<number>> {
    const { rows } = await this.db.execute<Record<string, unknown> & { id: number }>(
      sql`select id from products where id = any(${sql.param(ids)}::bigint[])`,
    );

    return new Set(rows.map((row) => Number(row.id)));
  }

  /** An empty batch still orders its removals, and a worker's own clock would
   *  outrank every token PostgreSQL ever wrote. */
  private async instant(): Promise<string> {
    const { rows } = await this.db.execute<Record<string, unknown> & { source_read_at: string }>(
      sql`select ${INSTANT} as source_read_at`,
    );

    return rows[0]!.source_read_at;
  }
}
