import { describe, expect, it } from 'vitest';
import { ingestionChunk } from '@src/modules/ingestion/events/ingestion-chunk.js';

describe('ingestionChunk', () => {
  it('accepts a valid payload unchanged', () => {
    expect(ingestionChunk.parse({ jobId: 7, chunkIndex: 0 })).toEqual({ jobId: 7, chunkIndex: 0 });
  });

  it('accepts chunk index zero, which is the first chunk of every job', () => {
    expect(ingestionChunk.parse({ jobId: 1, chunkIndex: 0 }).chunkIndex).toBe(0);
  });

  it.each([
    ['a missing chunk index', { jobId: 7 }],
    ['a negative chunk index', { jobId: 7, chunkIndex: -1 }],
    ['a zero job id', { jobId: 0, chunkIndex: 0 }],
    ['an unknown field', { jobId: 7, chunkIndex: 0, extra: 1 }],
  ])('rejects %s', (_reason, payload) => {
    expect(() => ingestionChunk.parse(payload)).toThrow();
  });
});
