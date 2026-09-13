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
      pending += decoder.write(window.subarray(cut, i));
      const endOffset = scanned + i + 1;
      yield { line: pending, endOffset };
      pending = '';
      lineStart = endOffset;
      cut = i + 1;
    }
    pending += decoder.write(window.subarray(cut));
    scanned += window.length;
  }

  pending += decoder.end();
  // A range whose last row has no terminator: the range end is where it stops.
  if (lineStart < to) yield { line: pending, endOffset: to };
}
