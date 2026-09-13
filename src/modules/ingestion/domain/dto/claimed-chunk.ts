/** A chunk this invocation holds the lease on, and the byte range left to read. */
export interface ClaimedChunk {
  jobId: number;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  nextOffset: number;
  /** The lease this claim took: the holder's proof when it hands the chunk back. */
  leaseUntil: Date;
  attempts: number;
  failures: number;
}
