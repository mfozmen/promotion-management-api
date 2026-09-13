import { describe, expect, it } from 'vitest';
import { chunkProcess } from '@src/modules/ingestion/events/chunk-process.js';

describe('chunkProcess', () => {
  it('accepts a valid payload unchanged', () => {
    expect(chunkProcess.parse({ jobId: 7, chunkIndex: 0 })).toEqual({ jobId: 7, chunkIndex: 0 });
  });

  it('accepts chunk index zero, which is the first chunk of every job', () => {
    expect(chunkProcess.parse({ jobId: 1, chunkIndex: 0 }).chunkIndex).toBe(0);
  });

  it.each([
    ['a missing chunk index', { jobId: 7 }],
    ['a negative chunk index', { jobId: 7, chunkIndex: -1 }],
    ['a zero job id', { jobId: 0, chunkIndex: 0 }],
    ['an unknown field', { jobId: 7, chunkIndex: 0, extra: 1 }],
  ])('rejects %s', (_reason, payload) => {
    expect(() => chunkProcess.parse(payload)).toThrow();
  });
});
