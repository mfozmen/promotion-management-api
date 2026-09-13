import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { serializeError } from '@src/shared/serialize-error.js';
import { useTestDatabase } from '../db.js';

const db = useTestDatabase();

/** A value a caller might really send, recognisable enough to grep a whole log line for. */
const BOUND_SECRET = 'sk-live-CUSTOMER-4242';

/** The real thing: drizzle wraps a `pg` `DatabaseError`, and the nesting is the library's. */
async function driverError(): Promise<unknown> {
  // Owns its row rather than inheriting one: both cases in this file call it, and the second
  // would otherwise fail on the first's leftover before reaching the duplicate it wants.
  await db().execute(
    sql`insert into products (sku, name, category, base_price_cents, stock_quantity)
        values ('SCRUB-1', 'first', 'Electronics', 1000, 1)
        on conflict (sku) do nothing`,
  );
  try {
    await db().execute(
      sql`insert into products (sku, name, category, base_price_cents, stock_quantity)
          values ('SCRUB-1', ${BOUND_SECRET}, 'Electronics', 1000, 1)`,
    );
  } catch (error) {
    return error;
  }
  throw new Error('the duplicate insert was expected to fail');
}

describe('serializeError against a real driver error', () => {
  it('keeps the bound value and the statement out of every field it emits', async () => {
    const serialized = serializeError(await driverError());

    // The whole line, not field by field: the leak was in four places at once — `message`,
    // `stack`, and the `query` and `params` own properties pino copies by default.
    const line = JSON.stringify(serialized);
    expect(line).not.toContain(BOUND_SECRET);
    expect(line).not.toContain('insert into products');
    expect(line).not.toContain('params:');
    expect(Object.keys(serialized)).not.toContain('query');
    expect(Object.keys(serialized)).not.toContain('params');
  });

  it('keeps what an operator needs: the SQLSTATE, the constraint and the frames', async () => {
    const serialized = serializeError(await driverError());

    expect(serialized.code).toBe('23505');
    expect(serialized.constraint).toBe('products_sku_unique');
    expect(serialized.type).toBe('DrizzleQueryError');
    // Frames locate the call, which nothing else in the line can do.
    expect(serialized.stack).toMatch(/^ {4}at /m);
  });
});
