import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

/**
 * Writes a vendor CSV of `--rows` rows for the ingestion measurement.
 *
 * Streamed with backpressure rather than joined into one string: the file this
 * generates is 500 000 rows, and building it in memory first would measure the
 * generator's heap rather than the importer's.
 *
 *   npm run generate:vendor -- --rows 500000 --out fixtures/vendor-500k.csv
 */
const CATEGORIES = ['Electronics', 'Accessories', 'Shoes', 'Outerwear', 'Bags'] as const;

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

const rows = Number(argument('rows', '500000'));
const out = argument('out', 'fixtures/vendor-500k.csv');

if (!Number.isSafeInteger(rows) || rows < 1) {
  console.error(`--rows must be a positive integer, not ${argument('rows', '500000')}`);
  process.exit(1);
}

const file = createWriteStream(out);
file.write('sku,name,category,price,stock\n');

for (let i = 0; i < rows; i += 1) {
  // Deterministic, so two runs of the measurement compare: the same row index is
  // always the same row, and prices repeat across a small range rather than
  // drifting upward into values no vendor would send.
  const category = CATEGORIES[i % CATEGORIES.length];
  const price = (1000 + (i % 9000)) / 100;
  const stock = i % 500;
  if (!file.write(`SKU-${i},Product ${i},${category},${price.toFixed(2)},${stock}\n`)) {
    await once(file, 'drain');
  }
}

file.end();
await once(file, 'finish');

console.log(`${rows} rows written to ${out}`);
