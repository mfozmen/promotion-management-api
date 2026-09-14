import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseVendorRow } from '@src/modules/ingestion/domain/parse-vendor-row.js';

const run = promisify(execFile);

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pma-generated-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the generated vendor file', () => {
  it('is a file the importer can actually read', async () => {
    // The generator writes the fixture the 500 000-row measurement runs on, and
    // the parser decides what counts as a row. Nothing else compares them, so a
    // column order or a price format that drifts apart would produce a run that
    // completes with every row rejected — a measurement of nothing that reports
    // success (REVIEW.md 13.12).
    const out = join(dir, 'sample.csv');

    await run('npx', ['tsx', 'scripts/generate-vendor-csv.ts', '--rows', '20', '--out', out], {
      cwd: process.cwd(),
      shell: true,
    });

    const [header, ...rows] = readFileSync(out, 'utf8').split('\n').filter(Boolean);

    expect(header).toBe('sku,name,category,price,stock');
    expect(rows).toHaveLength(20);
    const parsed = rows.map((row) => parseVendorRow(row));
    expect(parsed.filter((outcome) => !outcome.ok)).toEqual([]);

    // The values, not just the shape. Both `name` and `category` are free text, so
    // swapping those two columns parses cleanly and produces a catalogue whose
    // categories are product names — a file that imports and means nothing. The
    // categories are a closed set on the generator's side, which is what makes
    // the mistake visible here.
    const categories = new Set(['Electronics', 'Accessories', 'Shoes', 'Outerwear', 'Bags']);
    for (const outcome of parsed) {
      if (!outcome.ok) continue;
      expect(categories.has(outcome.row.category)).toBe(true);
      expect(outcome.row.sku).toMatch(/^SKU-\d+$/);
      expect(outcome.row.vendorPriceCents).toBeGreaterThan(0);
    }
  }, 60_000);
});
