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
 * The longest row this will hold in memory. A row longer than this is cut here
 * and rejected downstream on its column count.
 *
 * Without a cap the accumulator grows to the next newline, and a file with no
 * newline in its body has none: a vendor export whose header is LF-terminated
 * and whose rows end in CR alone — Excel for Mac, and several ERP exports —
 * arrives as one row the size of the upload. Peak memory then tracks the file
 * rather than the batch, which is the one thing chunking exists to prevent.
 *
 * Characters rather than bytes, because that is what the accumulator holds and
 * what bounds the heap; a JavaScript string is UTF-16, so the memory is up to
 * twice this. A megabyte is far past any real row (the widest seen is a few
 * hundred bytes) and far under the smallest chunk, so a legitimate row is never
 * cut.
 */
export const MAX_ROW_CHARS = 1024 * 1024;

/** Appends while the row is within its bound; past it, the row is already lost. */
function keep(pending: string, next: string): string {
  if (pending.length >= MAX_ROW_CHARS) return pending;
  return pending + next;
}

/**
 * Reads one chunk's rows back, from the byte it resumes at to the byte its range ends.
 *
 * A generator rather than an array because a chunk is megabytes and the point of
 * chunking is that no step holds the file (ADR-0005). One read window is live at a
 * time; a row longer than the window still arrives whole.
 *
 * `endOffset` is what makes a kill cost one batch instead of a chunk: it is the byte
 * a resume starts at, so it is past the terminator, never on it.
 *
 * Offsets are bytes throughout, which is why the decoder is separate from the scan —
 * `é` is two bytes and one character, and the two counts diverge on the first accented
 * product name. The `StringDecoder` holds a partial sequence across windows rather
 * than emitting the replacement character twice.
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
