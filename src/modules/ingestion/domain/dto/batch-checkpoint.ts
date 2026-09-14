/**
 * One batch's result, and the offset it believed it started from.
 *
 * `seenOffset` is what makes the write a compare-and-set: it is the value this
 * invocation read, and the update applies only if the row still holds it.
 */
export interface BatchCheckpoint {
  jobId: number;
  chunkIndex: number;
  seenOffset: number;
  nextOffset: number;
  rowsProcessed: number;
  rowsRejected: number;
}
