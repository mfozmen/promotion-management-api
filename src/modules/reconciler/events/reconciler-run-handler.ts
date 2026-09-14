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

  async handle(): Promise<void> {
    await this.sweep.execute();
  }
}
