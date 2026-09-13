/**
 * What one invocation did with a chunk.
 *
 * `claimed: false` is a success: another worker holds the lease, or the chunk is
 * already done, and a duplicate delivery returning at once is the design.
 */
export interface ChunkOutcome {
  claimed: boolean;
  rowsProcessed: number;
  rowsRejected: number;
}
