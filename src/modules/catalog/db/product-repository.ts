import type { Db } from '../../../shared/db/client.js';
import { products } from './schema/products.js';
import { hasSqlState } from '../../../shared/db/has-sql-state.js';
import { SqlState } from '../../../shared/db/sql-state.js';
import type { CreateProduct } from '../domain/dto/create-product-input.js';
import type { InsertProductOutcome } from '../domain/dto/insert-product-outcome.js';

export class ProductRepository {
  constructor(private readonly db: Db) {}

  /**
   * A duplicate SKU is decided by the unique index, never by a `SELECT` first:
   * two requests for one new SKU both pass a check-then-insert and one of them
   * still fails at the index, so the check only moves the error somewhere less
   * expected.
   */
  async insert(input: CreateProduct): Promise<InsertProductOutcome> {
    try {
      const rows = await this.db.insert(products).values(input).returning();
      // A single-row insert returns one row or throws, so the result is read as
      // the one-tuple it is rather than guarded for a length that cannot occur.
      const [row] = rows as [(typeof rows)[number]];
      return {
        ok: true,
        product: {
          id: row.id,
          sku: row.sku,
          name: row.name,
          category: row.category,
          basePriceCents: row.basePriceCents,
          stockQuantity: row.stockQuantity,
        },
      };
    } catch (error) {
      if (hasSqlState(error, SqlState.uniqueViolation)) return { ok: false, reason: 'sku-exists' };
      throw error;
    }
  }
}
