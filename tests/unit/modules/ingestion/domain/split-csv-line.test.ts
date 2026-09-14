import { describe, expect, it } from 'vitest';
import { splitCsvLine } from '@src/modules/ingestion/domain/split-csv-line.js';

describe('splitCsvLine', () => {
  it('splits on commas', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps a comma inside quotes', () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });

  it('reads a doubled quote as one quote', () => {
    expect(splitCsvLine('"he said ""hi"""')).toEqual(['he said "hi"']);
  });

  it('keeps empty fields, because position is what identifies a column', () => {
    expect(splitCsvLine('a,,c')).toEqual(['a', '', 'c']);
    expect(splitCsvLine(',')).toEqual(['', '']);
  });

  it('returns one empty field for an empty line rather than none', () => {
    expect(splitCsvLine('')).toEqual(['']);
  });

  it('treats an unterminated quote as running to the end of the line', () => {
    // The line has already been cut on 0x0A upstream, so there is no more input
    // to find a closing quote in. One field is the honest reading; the caller
    // rejects it on column count.
    expect(splitCsvLine('a,"b,c')).toEqual(['a', 'b,c']);
  });

  it('lets a quote mid-field start quoting, which the caller then rejects', () => {
    // RFC 4180 leaves this undefined. Opening a quote here absorbs the next
    // comma, so the line yields two fields instead of five and `parseVendorRow`
    // rejects it on column count — a malformed row costs itself and nothing else.
    expect(splitCsvLine('a,b"c,d')).toEqual(['a', 'bc,d']);
  });
});
