/** A chunk this invocation holds the lease on, and the byte range left to read. */
export interface ClaimedChunk {
  jobId: number;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  nextOffset: number;
  attempts: number;
  failures: number;
}
