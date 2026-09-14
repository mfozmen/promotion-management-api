import { boundaryRepairs } from '../../../shared/metrics/boundary-repairs.js';

interface Sweep {
  execute(): Promise<number>;
}

/**
 * What the `maintenance` worker hands a `reconciler.run` job. The payload is empty —
 * the window comes from the watermark, not from the job — so this is the seam between
 * the queue and the command rather than a place that decides anything (ADR-0008).
 */
export class ReconcilerRunHandler {
  constructor(private readonly sweep: Sweep) {}

  /** The `maintenance` dispatcher, here rather than in the entry point so a test can fail it
   *  (ADR-0003). */
  async handle(name: string): Promise<void> {
    if (name !== 'reconciler.run') throw new Error(`no handler for ${name}`);
    // Counted here rather than in the command, so the number a scrape reads and the number the
    // run returns cannot drift apart.
    boundaryRepairs.inc(await this.sweep.execute());
  }
}
