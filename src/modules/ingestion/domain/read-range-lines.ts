import { createReadStream } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

/** One row and the offset a checkpoint would store if the batch ending here committed. */
export interface RangeLine {
  line: string;
  /** Absolute byte offset of the first byte after this row's terminator. */
  endOffset: number;
}

const NEWLINE = 0x0a;

/**
 * The longest row held in memory; a longer one is cut and rejected downstream on
 * its column count. Without a cap a file with no newline in its body — a header
 * ending LF and rows ending CR alone — arrives as one row the size of the upload,
 * and peak memory tracks the file rather than the batch.
 */
export const MAX_ROW_CHARS = 1024 * 1024;

/** Appends while the row is within its bound; past it, the row is already lost. */
function keep(pending: string, next: string): string {
  if (pending.length >= MAX_ROW_CHARS) return pending;
  return pending + next;
}

/**
 * Reads one chunk's rows back, from the byte it resumes at to the byte its range
 * ends. One read window is live at a time.
 *
 * `endOffset` is the byte a resume starts at — past the terminator, never on it.
 * Offsets are bytes and text is characters, which is why the decoder is separate
 * from the scan: `é` is two bytes and one character, and a window that splits it
 * would otherwise yield two replacement characters.
 */
export async function* readRangeLines(
  path: string,
  from: number,
  to: number,
  windowBytes = 64 * 1024,
): AsyncGenerator<RangeLine> {
  if (from >= to) return;

  const stream = createReadStream(path, { start: from, end: to - 1, highWaterMark: windowBytes });
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let lineStart = from;
  let scanned = from;

  for await (const window of stream as AsyncIterable<Buffer>) {
    let cut = 0;
    for (let i = 0; i < window.length; i += 1) {
      if (window[i] !== NEWLINE) continue;
      // Decode only as far as this terminator, so the text and the byte count
      // advance together and a split character is never cut in half.
      pending = keep(pending, decoder.write(window.subarray(cut, i)));
      const endOffset = scanned + i + 1;
      yield { line: pending, endOffset };
      pending = '';
      lineStart = endOffset;
      cut = i + 1;
    }
    pending = keep(pending, decoder.write(window.subarray(cut)));
    scanned += window.length;
  }

  pending += decoder.end();
  // A range whose last row has no terminator: the range end is where it stops.
  if (lineStart < to) yield { line: pending, endOffset: to };
}
