import { logger } from '../shared/logger.js';

/**
 * Checked between chunks, on `heapUsed` and never on RSS. ADR-0005 rejects the RSS version by
 * name: *"An RSS-based memory guard: Node RSS does not shrink, so it either never fires or always
 * fires; batch size bounds memory instead."* `heapUsed` is also what `--max-old-space-size`
 * bounds, so the guard and the ceiling measure the same thing.
 *
 * It fires below that ceiling so the process leaves on its own terms — a checkpointed chunk
 * committed, a line saying why — instead of V8 throwing mid-batch or the cgroup sending
 * `SIGKILL`, and `restart: unless-stopped` brings it back with the next chunk resuming from the
 * watermark. Measured 2026-09-14: a containerised 500 000-row import peaks at a 25 MB heap under
 * the 192 MiB ceiling, so on today's workload this never fires. That is the point of recording
 * the number rather than tuning it.
 */
export function exitIfHeapExceeded(worker: string, limitBytes: number): void {
  const { heapUsed } = process.memoryUsage();
  if (heapUsed <= limitBytes) return;

  logger.warn({ worker, heapUsed, limitBytes }, 'heap over the limit; stopping after this chunk');
  process.exit(1);
}
