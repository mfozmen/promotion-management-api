/**
 * One chunk's byte range, half-open: `[startOffset, endOffset)`.
 *
 * Offsets rather than rows because a chunk has to be resumable without holding
 * the file: a worker reads exactly this range and checkpoints a byte position
 * inside it (ADR-0005).
 */
export interface ChunkBoundary {
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
}
