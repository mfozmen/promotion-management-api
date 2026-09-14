import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chunkBoundaries } from '@src/modules/ingestion/domain/chunk-boundaries.js';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pma-chunks-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Writes a file and returns its path; the content is bytes, not text, on purpose. */
function file(name: string, content: Buffer | string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

const header = 'sku,name,category,price,stock\n';
const row = (n: number) => `SKU-${n},name ${n},shoes,1000,5\n`;

describe('chunkBoundaries', () => {
  it('starts after the header so no chunk has to know what a header is', async () => {
    const path = file('plain.csv', header + row(1) + row(2));

    const [first] = await chunkBoundaries(path, 1024);

    expect(first?.startOffset).toBe(Buffer.byteLength(header));
  });

  it('starts after a UTF-8 BOM as well as the header', async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const path = file('bom.csv', Buffer.concat([bom, Buffer.from(header + row(1))]));

    const [first] = await chunkBoundaries(path, 1024);

    expect(first?.startOffset).toBe(bom.length + Buffer.byteLength(header));
  });

  it('covers the whole file with no gap and no overlap', async () => {
    const body = Array.from({ length: 200 }, (_, i) => row(i)).join('');
    const path = file('many.csv', header + body);
    const size = Buffer.byteLength(header + body);

    const chunks = await chunkBoundaries(path, 512);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.startOffset).toBe(Buffer.byteLength(header));
    expect(chunks.at(-1)?.endOffset).toBe(size);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]?.startOffset).toBe(chunks[i - 1]?.endOffset);
    }
  });

  it('ends every chunk just past a newline, so no row is split', async () => {
    const body = Array.from({ length: 200 }, (_, i) => row(i)).join('');
    const path = file('aligned.csv', header + body);
    const bytes = Buffer.from(header + body);

    const chunks = await chunkBoundaries(path, 512);

    for (const chunk of chunks) {
      expect(bytes[chunk.endOffset - 1]).toBe(0x0a);
    }
  });

  it('numbers chunks from zero, in order', async () => {
    const body = Array.from({ length: 100 }, (_, i) => row(i)).join('');
    const path = file('indexed.csv', header + body);

    const chunks = await chunkBoundaries(path, 256);

    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it('gives a one-row file one chunk', async () => {
    const path = file('one.csv', header + row(1));

    const chunks = await chunkBoundaries(path, 4 * 1024 * 1024);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.endOffset).toBe(Buffer.byteLength(header + row(1)));
  });

  it('gives a header-only file no chunks rather than an empty one', async () => {
    const path = file('header-only.csv', header);

    expect(await chunkBoundaries(path, 1024)).toEqual([]);
  });

  it('keeps the final row when the file does not end in a newline', async () => {
    const last = 'SKU-9,name 9,shoes,1000,5';
    const path = file('no-trailing-newline.csv', header + row(1) + last);

    const chunks = await chunkBoundaries(path, 1024);

    expect(chunks.at(-1)?.endOffset).toBe(Buffer.byteLength(header + row(1) + last));
  });

  it('ends at the file when a chunk has no newline left to find', async () => {
    // The tail after the last newline is longer than the read window, so the
    // scan runs off the end and the boundary is the file itself.
    const long = 'SKU-2,' + 'y'.repeat(200_000) + ',shoes,1000,5';
    const path = file('unterminated-tail.csv', header + row(1) + long);

    const chunks = await chunkBoundaries(path, Buffer.byteLength(header + row(1)) - 5);

    expect(chunks.at(-1)?.endOffset).toBe(Buffer.byteLength(header + row(1) + long));
  });

  it('gives an empty file no chunks', async () => {
    expect(await chunkBoundaries(file('empty.csv', ''), 1024)).toEqual([]);
  });

  it('gives a file with no newline at all no chunks, because it is all header', async () => {
    // Without a terminator there is no row, only a header line that never ended.
    expect(await chunkBoundaries(file('headerless.csv', 'sku,name'), 1024)).toEqual([]);
  });

  it('does not split a row whose bytes straddle the target size', async () => {
    // The target lands mid-row on purpose: the boundary has to move forward to
    // the newline, never backward, or two chunks would both claim the same row.
    const wide = `SKU-1,${'x'.repeat(300)},shoes,1000,5\n`;
    const path = file('straddle.csv', header + wide + row(2));

    const chunks = await chunkBoundaries(path, Buffer.byteLength(header) + 10);

    expect(chunks[0]?.endOffset).toBe(Buffer.byteLength(header + wide));
  });
});
