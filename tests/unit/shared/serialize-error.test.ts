import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { serializeError } from '@src/shared/serialize-error.js';
import { overlapError } from '../overlap-error.js';

describe('serializeError', () => {
  it('keeps the statement and the bound row out of what it emits', () => {
    const serialised = JSON.stringify(serializeError(overlapError()));

    expect(serialised).not.toContain('discount_bp');
    expect(serialised).not.toContain('3f1d5b8e-5c5f-4f2a-9a3e-2c7b1d4e6f80');
    expect(serialised).not.toContain('customer_email');
    expect(serialised).not.toContain('ayse@example.com');
    expect(serialised).not.toContain('Failed query');
    expect(serialised).not.toContain('PL/pgSQL');
  });

  it('keeps the SQLSTATE and the constraint name, which is what diagnoses it', () => {
    expect(serializeError(overlapError())).toMatchObject({
      type: 'PostgresError',
      code: '23P01',
      message: expect.stringContaining('promotions_no_overlap'),
      stack: expect.stringContaining('at '),
    });
  });

  it('emits the four whitelisted keys and nothing else', () => {
    expect(Object.keys(serializeError(overlapError())).sort()).toEqual([
      'code',
      'message',
      'stack',
      'type',
    ]);
  });

  it('keeps a statement out even when the message is longer than the bound', () => {
    const statement =
      'insert into products (sku, name, base_price_cents, vendor_token) values ($1)';
    // The check used to run on the already-truncated message, so a statement
    // quoted past the 200-character bound was compared against a string that
    // no longer held it, and the prefix went to the log.
    const err = Object.assign(new Error(`${'x'.repeat(150)} failed query: ${statement}`), {
      query: statement,
      params: ['A1'],
    });

    expect(serializeError(err).message).toBe('database query failed');
  });

  it('keeps the constraint name when a bound value is one character', () => {
    // 'a' appears in almost any sentence, so treating every bound value as a
    // secret to search for blinds the log for the caller who sent a short one.
    const err = Object.assign(
      new Error('duplicate key value violates unique constraint "products_sku_key"'),
      { query: 'insert into products (sku) values ($1)', params: ['a'] },
    );

    expect(serializeError(err).message).toContain('products_sku_key');
  });

  it('reads the root of the chain, not the wrapper that quoted it', () => {
    const driver = Object.assign(new Error('null value in column "sku"'), { code: '23502' });
    const repository = new Error('saving the product failed');
    repository.cause = driver;

    expect(serializeError(repository)).toMatchObject({ code: '23502', type: 'Error' });
  });

  it('terminates on a cause chain that loops', () => {
    // A retry wrapper that re-attaches the original error makes a cycle, and
    // an uncapped walk allocates until it throws — inside the error handler.
    const first = new Error('retry exhausted');
    const second = new Error('connection lost');
    first.cause = second;
    second.cause = first;

    expect(serializeError(first).message).toBe('connection lost');
  });

  it('does not let a bound value pose as a stack frame', () => {
    const err = new DrizzleQueryError(
      'insert into "products" ("name") values ($1)',
      ['Kazak\n    at secret-bound-value'],
      undefined,
    );

    expect(JSON.stringify(serializeError(err))).not.toContain('secret-bound-value');
  });

  it('drops a driver message from the first quoted value on', () => {
    const err = new DrizzleQueryError(
      'select * from "products" where "id" = $1',
      ['not-a-uuid'],
      Object.assign(
        new Error('invalid input syntax for type uuid: "not-a-uuid-but-a-customer-secret"'),
        { code: '22P02' },
      ),
    );

    expect(serializeError(err)).toMatchObject({
      code: '22P02',
      message: 'invalid input syntax for type uuid',
    });
  });

  it('omits the code when the error carries none, and when it is not a string', () => {
    expect(serializeError(new Error('plain'))).not.toHaveProperty('code', expect.anything());
    expect(serializeError(Object.assign(new Error('odd'), { code: 500 })).code).toBeUndefined();
  });

  it('reports the type of a thrown non-error, never its value', () => {
    expect(serializeError({ password: 'hunter2' })).toEqual({ type: 'object' });
  });
});
