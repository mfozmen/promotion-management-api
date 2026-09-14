import type { Logger } from 'pino';

interface Sweep {
  execute(): Promise<number>;
}

interface Drift {
  execute(): Promise<number>;
}

/**
 * What the `maintenance` worker hands a `reconciler.run` job. The payload is empty —
 * the window comes from the watermark, not from the job — so this is the seam between
 * the queue and the commands rather than a place that decides anything (ADR-0008).
 */
export class ReconcilerRunHandler {
  /** Named rather than positional: the boundary sweep and the import sweep have
   *  the same shape, so two positions could be transposed and every test would
   *  still pass. */
  constructor(
    private readonly sweeps: { boundaries: Sweep; imports: Sweep; drift: Drift },
    private readonly logger: Logger,
  ) {}

  /** The sweep first: it repairs what a lost announcement left stale, and the
   *  drift check then sees a read model that is as current as the queue can make
   *  it, so what remains is a write that was lost rather than one still in
   *  flight. A drift repair that raises is not swallowed — the job fails and
   *  BullMQ keeps it, because a run that repaired nothing and returned looks
   *  exactly like one with nothing to repair. */
  async handle(): Promise<void> {
    await this.sweeps.boundaries.execute();
    // An import whose worker died holds its vendor's next one out until a chunk
    // is re-enqueued, and nothing else ever asks (issue #134).
    await this.sweeps.imports.execute();

    const repaired = await this.sweeps.drift.execute();
    if (repaired > 0) this.logger.warn({ repaired }, 'categories repaired by the drift check');
  }
}
