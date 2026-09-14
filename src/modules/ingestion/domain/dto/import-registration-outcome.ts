/** Every way registering ends; the route maps a reason to a status, not a driver error. */
export type ImportRegistrationOutcome =
  | { ok: true; jobId: number; chunksTotal: number }
  | { ok: false; reason: 'duplicate-file' }
  | { ok: false; reason: 'vendor-busy' };
