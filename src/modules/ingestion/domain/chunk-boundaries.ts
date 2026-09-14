import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ChunkBoundary } from './dto/chunk-boundary.js';

const NEWLINE = 0x0a;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * Splits a vendor file into byte ranges a worker can process independently.
 *
 * One streaming pass, and nothing but the offsets is kept: the file is the size
 * of the catalogue and must never be held in memory. Every
 * boundary moves *forward* to the byte after a newline, so a row belongs to
 * exactly one chunk — moving backward would let two chunks claim the same row,
 * and the upsert would hide it rather than fail.
 *
 * `targetBytes` is a target, not a maximum: a row longer than it produces a
 * chunk longer than it, because the alternative is splitting the row.
 */
export async function chunkBoundaries(path: string, targetBytes: number): Promise<ChunkBoundary[]> {
  const size = (await stat(path)).size;
  const start = await firstRowOffset(path);
  if (start >= size) return [];

  const boundaries: ChunkBoundary[] = [];
  let chunkStart = start;

  for (;;) {
    const target = chunkStart + targetBytes;
    if (target >= size) {
      boundaries.push({ chunkIndex: boundaries.length, startOffset: chunkStart, endOffset: size });
      return boundaries;
    }

    const end = await nextNewlineAfter(path, target, size);
    boundaries.push({ chunkIndex: boundaries.length, startOffset: chunkStart, endOffset: end });
    if (end >= size) return boundaries;
    chunkStart = end;
  }
}

/** Past the BOM, if any, and past the header line. */
async function firstRowOffset(path: string): Promise<number> {
  const size = (await stat(path)).size;
  const head = await read(path, 0, Math.min(size, 64 * 1024));
  const afterBom = head.subarray(0, BOM.length).equals(BOM) ? BOM.length : 0;
  const newline = head.indexOf(NEWLINE, afterBom);
  return newline === -1 ? size : newline + 1;
}

/** The offset just past the first newline at or after `from`. */
async function nextNewlineAfter(path: string, from: number, size: number): Promise<number> {
  const step = 64 * 1024;
  for (let at = from; at < size; at += step) {
    const buffer = await read(path, at, Math.min(step, size - at));
    const found = buffer.indexOf(NEWLINE);
    if (found !== -1) return at + found + 1;
  }
  return size;
}

function read(path: string, start: number, length: number): Promise<Buffer> {
  if (length <= 0) return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    createReadStream(path, { start, end: start + length - 1 })
      .on('data', (chunk) => chunks.push(chunk as Buffer))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject);
  });
}
