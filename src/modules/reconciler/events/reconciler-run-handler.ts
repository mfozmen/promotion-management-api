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

  /** The name is checked here rather than in the entry point: `readmodel.rebuild` shares this
   *  queue and has no handler yet, and a process that acknowledged it would drop a rebuild. */
  async handle(name: string): Promise<void> {
    if (name !== 'reconciler.run') throw new Error(`no handler for ${name}`);
    await this.sweep.execute();
  }
}
