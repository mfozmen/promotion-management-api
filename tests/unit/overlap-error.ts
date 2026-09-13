import { DrizzleQueryError } from 'drizzle-orm';

/** The real class, not a hand-built lookalike: drizzle puts the statement and
 *  the bound row in `message` and the SQLSTATE on `cause`, and a fixture that
 *  guesses that shape certifies the leak it was written to catch. */
export function overlapError(): DrizzleQueryError {
  const pgError = Object.assign(
    new Error('conflicting key value violates exclusion constraint "promotions_no_overlap"'),
    {
      name: 'PostgresError',
      code: '23P01',
      detail: 'Key (product_id)=(3f1d5b8e-5c5f-4f2a-9a3e-2c7b1d4e6f80) conflicts.',
      where: 'PL/pgSQL function',
    },
  );

  return new DrizzleQueryError(
    'insert into "promotions" ("product_id", "discount_bp", "customer_email") values ($1, $2, $3)',
    ['3f1d5b8e-5c5f-4f2a-9a3e-2c7b1d4e6f80', 2000, 'ayse@example.com'],
    pgError,
  );
}
