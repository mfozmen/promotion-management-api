import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_ROW_CHARS, readRangeLines } from '@src/modules/ingestion/domain/read-range-lines.js';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pma-range-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, content: Buffer | string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

async function collect(
  path: string,
  from: number,
  to: number,
  windowBytes?: number,
): Promise<{ line: string; endOffset: number }[]> {
  const out = [];
  for await (const item of readRangeLines(path, from, to, windowBytes)) out.push(item);
  return out;
}

describe('readRangeLines', () => {
  it('yields each line without its terminator', async () => {
    const path = file('plain.csv', 'a,1\nb,2\nc,3\n');

    expect((await collect(path, 0, 12)).map((l) => l.line)).toEqual(['a,1', 'b,2', 'c,3']);
  });

  it('reports the byte after the newline, which is what a checkpoint stores', async () => {
    // The offset has to be resumable as given: restarting at it must read the next
    // line whole, so it is the first byte of that line, not the newline before it.
    const path = file('offsets.csv', 'a,1\nb,2\n');

    expect((await collect(path, 0, 8)).map((l) => l.endOffset)).toEqual([4, 8]);
  });

  it('starts at the offset given, so a resume reads no row twice', async () => {
    const path = file('resume.csv', 'a,1\nb,2\nc,3\n');

    expect((await collect(path, 4, 12)).map((l) => l.line)).toEqual(['b,2', 'c,3']);
  });

  it('stops at the end of the range, leaving the next chunk its own rows', async () => {
    const path = file('bounded.csv', 'a,1\nb,2\nc,3\n');

    expect((await collect(path, 0, 8)).map((l) => l.line)).toEqual(['a,1', 'b,2']);
  });

  it('yields a final line that has no trailing newline, ending at the range', async () => {
    const path = file('unterminated.csv', 'a,1\nb,2');

    expect(await collect(path, 0, 7)).toEqual([
      { line: 'a,1', endOffset: 4 },
      { line: 'b,2', endOffset: 7 },
    ]);
  });

  it('yields nothing for an empty range', async () => {
    expect(await collect(file('empty-range.csv', 'a,1\n'), 4, 4)).toEqual([]);
  });

  it('keeps a multi-byte character whole when it straddles the read window', async () => {
    // 'é' is two bytes. Decoding each window on its own splits it into two
    // replacement characters, and the product name reaches the catalogue corrupted.
    // The window is 10 bytes so it ends between the two bytes of 'é' (offsets 9
    // and 10) rather than before them — with 8 the character sits whole inside
    // the second window and the test passes without the decoder doing anything.
    const content = 'SKU-1,café,shoes,1000,5\n';
    const path = file('utf8.csv', content);

    const lines = await collect(path, 0, Buffer.byteLength(content), 10);

    expect(lines.map((l) => l.line)).toEqual(['SKU-1,café,shoes,1000,5']);
  });

  it('reads a line longer than the window', async () => {
    const long = `SKU-1,${'x'.repeat(5000)},shoes,1000,5`;
    const path = file('long.csv', `${long}\n`);

    const lines = await collect(path, 0, Buffer.byteLength(long) + 1, 64);

    expect(lines.map((l) => l.line)).toEqual([long]);
  });

  it('bounds a row that never ends, so the heap is the cap and not the file', async () => {
    // A vendor export whose header is LF-terminated and whose body uses CR-only
    // line endings — Excel for Mac, and several ERP exports — has no newline in
    // its body at all. The whole file is then one "row", and an accumulator with
    // no cap makes peak memory the upload size rather than the batch size, which
    // is the one thing Scenario A promises it is not.
    const wide = 'x'.repeat(3 * 1024 * 1024);
    const path = file('unterminated.csv', `${wide}
SKU-2,name,shoes,1000,5
`);

    const lines = await collect(path, 0, Buffer.byteLength(wide) + 1 + 26);

    // The oversized row is cut to the cap rather than held whole; it fails the
    // column count downstream and is counted as a rejected row.
    expect(lines[0]!.line.length).toBeLessThanOrEqual(MAX_ROW_CHARS);
    // And the scan resynchronises: the row after it arrives intact, at the right
    // offset, so one malformed row costs one row and not the rest of the chunk.
    expect(lines[1]?.line).toBe('SKU-2,name,shoes,1000,5');
    expect(lines[1]?.endOffset).toBe(Buffer.byteLength(wide) + 1 + 24);
  });

  it('counts offsets in bytes, not characters, so a checkpoint after é is resumable', async () => {
    // 'café\n' is six bytes and five characters. An offset counted in characters
    // would resume one byte inside the 'é' of the line before.
    const content = 'café\nb\n';
    const path = file('utf8-offsets.csv', content);

    const lines = await collect(path, 0, Buffer.byteLength(content));

    expect(lines.map((l) => l.endOffset)).toEqual([6, 8]);
  });
});
