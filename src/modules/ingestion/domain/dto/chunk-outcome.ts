/**
 * What one invocation did with a chunk.
 *
 * `claimed: false` is a success: another worker holds the lease, or the chunk is
 * already done, and a duplicate delivery returning at once is the design.
 *
 * `superseded` says this invocation's lease expired while it worked and another
 * one took the chunk: its compare-and-set was refused, so it stopped where it
 * stood. The counts are what it committed before that, not what it read.
 */
export interface ChunkOutcome {
  claimed: boolean;
  superseded?: boolean;
  rowsProcessed: number;
  rowsRejected: number;
}
