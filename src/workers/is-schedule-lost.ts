/**
 * BullMQ upserts the next iteration of a repeatable job when the worker picks one up, and on a
 * failure it emits this and returns rather than throwing — so the chain stops for ever while the
 * process stays up. Re-asserting per run is not the repair: the upsert enqueues its first
 * iteration immediately, which would make that a hot loop.
 */
export function isScheduleLost(error: Error): boolean {
  return error.message.startsWith('Failed to add repeatable job');
}
