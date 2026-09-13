import { splitCsvLine } from './split-csv-line.js';
import type { VendorRowOutcome } from './dto/vendor-row-outcome.js';

/** `sku,name,category,vendor_price,stock_quantity` (decision K3). */
const COLUMNS = 5;

/** At most two fraction places, no sign, no exponent, no separators. */
const PRICE = /^\d+(?:\.\d{1,2})?$/;
const STOCK = /^\d+$/;

/**
 * Turns one line into a row, or into the reason it is not one.
 *
 * The price is read digit by digit rather than through `Number`: `8.70 * 100` is
 * `869.9999999999999` in IEEE 754, and truncating that pays the vendor 869 cents
 * for an 870-cent product. Padding the fraction to two places and concatenating
 * is exact for every input the contract allows (REVIEW.md 1.1).
 */
export function parseVendorRow(line: string): VendorRowOutcome {
  const fields = splitCsvLine(line.endsWith('\r') ? line.slice(0, -1) : line);
  if (fields.length !== COLUMNS) return { ok: false, reason: `expected ${COLUMNS} columns` };

  const [sku, name, category, price, stock] = fields.map((field) => field.trim()) as [
    string,
    string,
    string,
    string,
    string,
  ];

  const rejection = fieldRejection({ sku, name, category, price, stock });
  if (rejection !== undefined) return { ok: false, reason: rejection };

  const [whole, fraction = ''] = price.split('.');
  const cents = Number(`${whole}${fraction.padEnd(2, '0')}`);
  if (!Number.isSafeInteger(cents)) return { ok: false, reason: 'vendor_price is out of range' };

  const stockQuantity = Number(stock);
  if (!Number.isSafeInteger(stockQuantity)) {
    return { ok: false, reason: 'stock_quantity is out of range' };
  }

  return { ok: true, row: { sku, name, category, vendorPriceCents: cents, stockQuantity } };
}

/** Each field against the contract, in the order a reader would check them. */
function fieldRejection(fields: {
  sku: string;
  name: string;
  category: string;
  price: string;
  stock: string;
}): string | undefined {
  if (fields.sku === '') return 'sku is empty';
  if (fields.name === '') return 'name is empty';
  if (fields.category === '') return 'category is empty';
  if (!PRICE.test(fields.price)) {
    return 'vendor_price is not a decimal with at most two fraction places';
  }
  if (!STOCK.test(fields.stock)) return 'stock_quantity is not a whole number';
  return undefined;
}
