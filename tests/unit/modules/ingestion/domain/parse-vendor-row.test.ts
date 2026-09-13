import { describe, expect, it } from 'vitest';
import { parseVendorRow } from '@src/modules/ingestion/domain/parse-vendor-row.js';

const ok = (line: string) => {
  const result = parseVendorRow(line);
  if (!result.ok) throw new Error(`expected a row, got: ${result.reason}`);
  return result.row;
};

describe('parseVendorRow', () => {
  it('reads the five columns the vendor contract names', () => {
    expect(ok('SKU-1,Wool scarf,Accessories,799.90,12')).toEqual({
      sku: 'SKU-1',
      name: 'Wool scarf',
      category: 'Accessories',
      vendorPriceCents: 79990,
      stockQuantity: 12,
    });
  });

  it.each([
    ['two fraction places', '799.90', 79990],
    ['one fraction place', '799.9', 79990],
    ['no fraction places', '799', 79900],
    ['zero', '0', 0],
    ['a price too large for a float to hold exactly', '90071992547409.91', 9007199254740991],
  ])('parses %s without floating point', (_case, price, cents) => {
    expect(ok(`SKU-1,n,c,${price},1`).vendorPriceCents).toBe(cents);
  });

  it('does not go through Number for the fraction', () => {
    // 8.70 * 100 is 869.9999999999999 in IEEE 754. A parser that multiplies
    // gets 869 after truncation; the vendor is owed 870.
    expect(ok('SKU-1,n,c,8.70,1').vendorPriceCents).toBe(870);
    expect(ok('SKU-1,n,c,1.10,1').vendorPriceCents).toBe(110);
  });

  it('strips a trailing carriage return, so CRLF files parse', () => {
    expect(ok('SKU-1,n,c,10.00,1\r').stockQuantity).toBe(1);
  });

  it('trims the strings it keeps', () => {
    expect(ok('  SKU-1 , Wool scarf , Accessories ,10.00,1')).toMatchObject({
      sku: 'SKU-1',
      name: 'Wool scarf',
      category: 'Accessories',
    });
  });

  it('supports quoting within a line, because a name may hold a comma', () => {
    expect(ok('SKU-1,"Scarf, wool","Accessories",10.00,1').name).toBe('Scarf, wool');
  });

  it('reads a doubled quote inside a quoted field as one quote', () => {
    expect(ok('SKU-1,"The ""good"" one",c,10.00,1').name).toBe('The "good" one');
  });

  it.each([
    ['three fraction places', 'SKU-1,n,c,10.001,1'],
    ['a non-numeric price', 'SKU-1,n,c,ten,1'],
    ['a negative price', 'SKU-1,n,c,-1.00,1'],
    ['a fractional stock quantity', 'SKU-1,n,c,10.00,1.5'],
    ['a negative stock quantity', 'SKU-1,n,c,10.00,-1'],
    ['an empty sku', ',n,c,10.00,1'],
    ['an empty name', 'SKU-1,,c,10.00,1'],
    ['a blank category', 'SKU-1,n,   ,10.00,1'],
    ['too few columns', 'SKU-1,n,c,10.00'],
    ['too many columns', 'SKU-1,n,c,10.00,1,extra'],
    ['an empty line', ''],
    ['a price in exponent form', 'SKU-1,n,c,1e3,1'],
    ['a price with a thousands separator', 'SKU-1,n,c,1,000.00,1'],
  ])('rejects %s rather than throwing', (_case, line) => {
    const result = parseVendorRow(line);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBeTruthy();
  });

  it.each([
    ['a stock quantity past the safe integer range', `SKU-1,n,c,10.00,${'9'.repeat(20)}`, 'stock_quantity'],
    ['a price past the safe integer range', `SKU-1,n,c,${'9'.repeat(20)}.99,1`, 'vendor_price'],
  ])('rejects %s', (_case, line, field) => {
    // Both pass their pattern — they are digits — and fail on magnitude, which is
    // the check the pattern cannot make.
    const result = parseVendorRow(line);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(field);
  });

  it('names the field it rejected, so a defect log can be acted on', () => {
    const result = parseVendorRow('SKU-1,n,c,10.001,1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('vendor_price');
  });

  it('never returns a reason carrying the rejected value', () => {
    // REVIEW.md 8.3b: the value is the vendor's, and a log line is not the place
    // to reproduce it. The field name is what makes the row findable.
    const result = parseVendorRow('SKU-1,n,c,not-a-price-9999,1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain('9999');
  });
});
